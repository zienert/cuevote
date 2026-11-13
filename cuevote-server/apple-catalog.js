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

// Picking from a search. Apple often ranks remixes, live and lyric videos,
// covers and other songs by the same artist before the original (Nov. 2026:
// "Dua Lipa Levitating" gave the Blessed Madonna remix first, "Bohemian
// Rhapsody" a live take and then a cover). Whoever types a song title wants the
// original, ideally its music video; whoever types "remix" or "live" gets one.

// Words in a title's decoration (brackets, after " - ") that mark another
// recording or a lesser video. Plurals and spellings fold into one word (FOLD).
const OTHER_RECORDING = new Set([
    'remix', 'rmx', 'mix', 'live', 'acoustic', 'unplugged', 'version', 'demo',
    'extended', 'sped', 'slowed', 'reverb', 'nightcore', 'karaoke', 'instrumental',
    'cover', 'session', 'performance', 'mashup', 'medley', 'megamix', 'bootleg',
    'piano', 'orchestral', 'stripped',
]);
const LESSER_VIDEO = new Set(['lyric', 'visualizer', 'audio', 'directors']);
// Alone (next to neutral words) these still name the original: "(Radio Mix)",
// "(Single Version)", "(Original Mix)".
const ORIGINAL_WHEN_ALONE = new Set(['version', 'mix']);
// Not music at all; these count anywhere in the title. ("Behind" and "making"
// alone would hit "Behind Blue Eyes" and "Making Love Out of Nothing at All".)
const NOT_MUSIC = new Set(['interview', 'trailer', 'teaser', 'documentary', 'commentary', 'reaction']);
const NOT_MUSIC_PHRASES = [' behind the scenes ', ' making of '];
// Decoration that leaves the original as it is: quality, labels, the usual edits.
const NEUTRAL = new Set([
    'official', 'oficial', 'officiel', 'officielle', 'offizielles', 'ufficiale',
    'video', 'videoclip', 'clip', 'music', 'musikvideo', 'mv', 'hd', '4k', 'uhd',
    'remaster', 'remastered', 'explicit', 'clean', 'uncensored',
    'radio', 'single', 'album', 'edit', 'original', 'main', 'short', 'mono', 'stereo',
]);
// Decoration starting with these is a credit: (feat. X), (with X), (From "Film").
const CREDIT = new Set(['feat', 'ft', 'featuring', 'with', 'from', 'prod', 'aus', 'uit']);
const FOLD = Object.freeze({
    lyrics: 'lyric', remixes: 'remix', sessions: 'session', versions: 'version',
    visualiser: 'visualizer', akustik: 'acoustic', director: 'directors',
});
// Too common to tell anything about a title or an artist.
const STOP_WORDS = new Set([
    'the', 'and', 'a', 'an', 'of', 'in', 'at', 'on', 'feat', 'ft', 'with', 'x',
    'und', 'der', 'die', 'das', 'dem', 'den', 'ein', 'eine', 'de', 'het', 'een',
    'la', 'le', 'les', 'el', 'los', 'y', 'et',
]);

function words(text) {
    return String(text || '')
        .normalize('NFKD').replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/['’`]/g, '')
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean)
        .map(word => FOLD[word] || word);
}

function artistWords(artist) {
    return words(artist).filter(word => !STOP_WORDS.has(word));
}

// "Levitating (feat. DaBaby) [Remix] - Live" -> base words of "Levitating",
// decoration groups "feat. DaBaby", "Remix", "Live".
function splitTitle(title) {
    const groups = [];
    const stripped = String(title || '').replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (_, round, square) => {
        groups.push(round || square || '');
        return ' ';
    });
    const [head, ...tail] = stripped.split(/\s[-–—]\s/);
    groups.push(...tail);
    return { base: words(head), groups: groups.map(words) };
}

// What one decoration group says: nothing (credits, quality, "Radio Edit"),
// a variant (remix, live, lyric video: penalty), or something else, such as a
// subtitle, a TV show or a campaign. "asked" when the query names it.
function judgeGroup(group, query) {
    const none = { kind: 'none', penalty: 0, asked: false };
    if (group.length === 0 || CREDIT.has(group[0])) return none;
    const meaningful = group.filter(word => !NEUTRAL.has(word) && !STOP_WORDS.has(word) && !/^[0-9]+$/.test(word));
    if (meaningful.every(word => ORIGINAL_WHEN_ALONE.has(word)) && meaningful.length <= 1) return none;
    const variants = meaningful.filter(word => OTHER_RECORDING.has(word) || LESSER_VIDEO.has(word));
    if (variants.length === 0) {
        return { kind: 'other', penalty: 0, asked: meaningful.every(word => query.has(word)) };
    }
    const unasked = variants.filter(word => !query.has(word));
    if (unasked.length === 0) return { kind: 'variant', penalty: 0, asked: true };
    return { kind: 'variant', penalty: unasked.some(word => OTHER_RECORDING.has(word)) ? 2 : 1, asked: false };
}

function isNotMusic(titleWords, query) {
    const joined = ` ${titleWords.join(' ')} `;
    return titleWords.some(word => NOT_MUSIC.has(word) && !query.has(word))
        || NOT_MUSIC_PHRASES.some(phrase => joined.includes(phrase) && !query.has(phrase.trim().split(' ')[0]));
}

function analyze(track, query) {
    const titleWords = words(track.title);
    const titleSet = new Set(titleWords);
    const { base, groups } = splitTitle(track.title);
    const artist = artistWords(track.artist);
    const rest = [...query].filter(word => !artist.includes(word) && !STOP_WORDS.has(word));
    const judged = groups.map(group => judgeGroup(group, query));
    const baseSet = new Set(base);
    return {
        track,
        artist,
        // Same artist, same title: one song, whatever the decoration says.
        song: `${artist.join(' ')}|${base.join(' ')}`,
        // The title is in the query, or the query (without the artist) is in the title.
        titleHit: (base.length > 0 && base.every(word => query.has(word)))
            || (rest.length > 0 && rest.every(word => titleSet.has(word))),
        // Words the title explains do not name the artist: "Cordula Grün" by
        // an act called Cordula Grün is no hint for that act.
        artistHit: artist.some(word => query.has(word) && !baseSet.has(word)),
        plain: judged.every(j => j.kind === 'none'),
        notMusic: isNotMusic(titleWords, query),
        judged,
    };
}

// Without an artist in the query: the artist with the most results for the
// title, songs first. That is the original's far more often than a cover's.
function originalArtist(analyzed) {
    if (analyzed.some(c => c.artistHit)) return [];
    const matching = analyzed.filter(c => c.titleHit);
    const counts = new Map();
    for (const c of matching.length > 0 ? matching : analyzed) {
        const name = c.artist.join(' ');
        if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    let best = '';
    let bestCount = 0;
    for (const [name, count] of counts) {
        if (count > bestCount) [best, bestCount] = [name, count];
    }
    return best ? best.split(' ') : [];
}

function score(c, original, plainSongs) {
    let penalty = 0;
    let asked = false;
    if (c.notMusic) {
        penalty = 6;
    } else {
        for (const j of c.judged) {
            // A subtitle is part of the title, unless the same song also
            // exists without it: then it is a special edition.
            const p = j.kind === 'other' ? (!j.asked && plainSongs.has(c.song) ? 1.5 : 0) : j.penalty;
            penalty = Math.max(penalty, p);
            asked = asked || j.asked;
        }
    }
    const originalHit = c.artist.some(word => original.includes(word));
    return (c.titleHit ? 4 : 0) + (c.artistHit ? 2 : 0) + (originalHit ? 2 : 0)
        + 3 - penalty + (asked ? 1 : 0) - (c.track.kind === 'song' ? 1 : 0);
}

/**
 * The search result a guest most likely meant: the title they typed, by the
 * artist they named (or the original artist), the original rather than a
 * remix, live or lyric video unless they asked for one, a music video rather
 * than the plain song. Ties keep Apple's order, music videos first. Returns
 * null without results.
 */
function bestMatch(term, { videos = [], songs = [] } = {}) {
    const query = new Set(words(term));
    const candidates = [
        ...songs.map((track, index) => ({ ...analyze(track, query), index, kind: 1 })),
        ...videos.map((track, index) => ({ ...analyze(track, query), index, kind: 0 })),
    ];
    if (candidates.length === 0) return null;
    const original = originalArtist(candidates);
    const plainSongs = new Set(candidates.filter(c => c.plain).map(c => c.song));
    for (const c of candidates) c.score = score(c, original, plainSongs);
    candidates.sort((a, b) => (b.score - a.score) || (a.kind - b.kind) || (a.index - b.index));
    return candidates[0].track;
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
    bestMatch,
    createAppleCatalog,
    parseAppleMusicLink,
    isStorefront,
    toTrack,
    artworkUrl,
};
