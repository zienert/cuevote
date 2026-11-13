// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
//
// Apple Music catalog: search, lookup by id and music.apple.com links, for
// Apple Music rooms. Guests suggest through the server, so their devices never
// talk to Apple; only the host's MusicKit player does.
//
// Every request needs a developer token (apple-music.js, getServerToken) and is
// scoped to a storefront, the two-letter country of the host's Apple account,
// because availability differs per country.
// https://developer.apple.com/documentation/applemusicapi
const { appleTrackKey, parseTrackKey, CATALOG_TYPE_BY_KIND } = require('./track-keys');

const API_BASE = 'https://api.music.apple.com/v1/catalog';
const STOREFRONT = /^[a-z]{2}$/;
const REQUEST_TIMEOUT_MS = 8000;
// Ids per lookup request; small enough to stay well inside Apple's limits.
const LOOKUP_CHUNK = 25;

// Catalog resource type -> MusicKit kind.
const KIND_BY_TYPE = Object.freeze({ 'music-videos': 'musicVideo', songs: 'song' });

class AppleCatalogError extends Error {
    constructor(message, { status = null, code = 'APPLE_CATALOG_ERROR' } = {}) {
        super(message);
        this.name = 'AppleCatalogError';
        this.status = status;
        this.code = code;
    }
}

function isStorefront(value) {
    return typeof value === 'string' && STOREFRONT.test(value);
}

/**
 * Artwork comes as a URL template with {w} and {h}. Videos are 16:9, songs square.
 */
function artworkUrl(artwork, kind) {
    if (!artwork || typeof artwork.url !== 'string') return null;
    const [w, h] = kind === 'musicVideo' ? [640, 360] : [600, 600];
    return artwork.url.replace('{w}', String(w)).replace('{h}', String(h)).replace('{f}', 'jpg');
}

/**
 * Turns a catalog resource into the track fields the room uses. Returns null
 * for resources that cannot be played (no playParams) or have no duration.
 */
function toTrack(resource) {
    const kind = resource && KIND_BY_TYPE[resource.type];
    const attributes = resource && resource.attributes;
    if (!kind || !attributes || !attributes.playParams) return null;
    const durationMs = Number(attributes.durationInMillis);
    if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
    let videoId;
    try {
        videoId = appleTrackKey(kind, resource.id);
    } catch {
        return null;
    }
    return {
        videoId,
        provider: 'apple',
        kind,
        title: attributes.name || '',
        artist: attributes.artistName || '',
        thumbnail: artworkUrl(attributes.artwork, kind),
        duration: Math.round(durationMs / 1000),
        explicit: attributes.contentRating === 'explicit',
    };
}

/**
 * Recognizes music.apple.com links to a music video or a song:
 *   https://music.apple.com/nl/music-video/new-rules/1258705880
 *   https://music.apple.com/us/song/levitating/1538003843
 *   https://music.apple.com/us/album/levitating/1538003494?i=1538003843
 * Returns { kind, id } or null. The link's own storefront is ignored: the
 * room plays from the host's.
 */
function parseAppleMusicLink(input) {
    if (typeof input !== 'string') return null;
    let url;
    try {
        url = new URL(input.trim());
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.hostname !== 'music.apple.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    // [storefront, type, slug?, id]
    if (parts.length < 3 || !STOREFRONT.test(parts[0])) return null;
    const type = parts[1];
    const last = parts[parts.length - 1];
    if (type === 'music-video' && /^[0-9]{1,20}$/.test(last)) return { kind: 'musicVideo', id: last };
    if (type === 'song' && /^[0-9]{1,20}$/.test(last)) return { kind: 'song', id: last };
    if (type === 'album') {
        const songId = url.searchParams.get('i');
        if (songId && /^[0-9]{1,20}$/.test(songId)) return { kind: 'song', id: songId };
    }
    return null;
}

/**
 * @param {object} options
 * @param {() => {token: string}} options.getToken  developer token for server use
 * @param {typeof fetch} [options.fetchImpl]
 */
function createAppleCatalog({ getToken, fetchImpl = (...args) => fetch(...args) }) {
    async function request(path, params) {
        const url = new URL(`${API_BASE}/${path}`);
        for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, value);
        const { token } = getToken();
        let response;
        try {
            response = await fetchImpl(url.toString(), {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (err) {
            throw new AppleCatalogError(`Apple Music catalog unreachable: ${err && err.message}`, { code: 'APPLE_CATALOG_UNREACHABLE' });
        }
        if (response.status === 429) {
            throw new AppleCatalogError('Apple Music catalog rate limit', { status: 429, code: 'APPLE_CATALOG_RATE_LIMITED' });
        }
        if (response.status === 401 || response.status === 403) {
            throw new AppleCatalogError('Apple Music rejected the developer token', { status: response.status, code: 'APPLE_CATALOG_UNAUTHORIZED' });
        }
        if (!response.ok) {
            throw new AppleCatalogError(`Apple Music catalog answered ${response.status}`, { status: response.status });
        }
        return response.json();
    }

    /**
     * Search music videos and songs. Returns { videos: [...], songs: [...] }
     * as track fields, playable items only, in Apple's order.
     */
    async function search(storefront, term, { limit = 5 } = {}) {
        if (!isStorefront(storefront)) throw new AppleCatalogError(`Invalid storefront: ${storefront}`, { code: 'APPLE_CATALOG_BAD_STOREFRONT' });
        const query = String(term || '').trim();
        if (!query) return { videos: [], songs: [] };
        const body = await request(`${storefront}/search`, {
            term: query.slice(0, 200),
            types: 'music-videos,songs',
            limit: String(Math.min(Math.max(limit, 1), 25)),
        });
        const results = (body && body.results) || {};
        const pick = (type) => ((results[type] && results[type].data) || []).map(toTrack).filter(Boolean);
        return { videos: pick('music-videos'), songs: pick('songs') };
    }

    /**
     * Look up Apple track keys. Returns a Map key -> track fields, without the
     * keys Apple did not return (gone, not in this storefront, not playable).
     */
    async function lookup(storefront, keys) {
        if (!isStorefront(storefront)) throw new AppleCatalogError(`Invalid storefront: ${storefront}`, { code: 'APPLE_CATALOG_BAD_STOREFRONT' });
        const idsByKind = { musicVideo: [], song: [] };
        for (const key of new Set(keys || [])) {
            const parsed = parseTrackKey(key);
            if (parsed && parsed.provider === 'apple') idsByKind[parsed.kind].push(parsed.id);
        }
        const found = new Map();
        for (const [kind, ids] of Object.entries(idsByKind)) {
            for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) {
                const chunk = ids.slice(i, i + LOOKUP_CHUNK);
                const body = await request(`${storefront}/${CATALOG_TYPE_BY_KIND[kind]}`, { ids: chunk.join(',') });
                for (const resource of (body && body.data) || []) {
                    const track = toTrack(resource);
                    if (track) found.set(track.videoId, track);
                }
            }
        }
        return found;
    }

    return { search, lookup };
}

module.exports = {
    AppleCatalogError,
    createAppleCatalog,
    parseAppleMusicLink,
    isStorefront,
    toTrack,
    artworkUrl,
};
