// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
//
// Track keys: the one string that identifies a playable item in the queue,
// history, bans and the metadata cache (`videoId` on the wire and in the DB).
//
//   dQw4w9WgXcQ            YouTube video (a bare id, as it always was)
//   am:video:1258705880    Apple Music music video
//   am:song:1440899467     Apple Music song
//
// Bare ids stay YouTube, so no stored data changes. Apple keys name their
// catalog type because the catalog API and MusicKit's queue need to know
// whether an id is a music video or a song. A colon never occurs in a YouTube
// id, so the two kinds of key cannot collide.

const PROVIDERS = Object.freeze(['youtube', 'apple']);

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const APPLE_KEY = /^am:(video|song):([0-9]{1,20})$/;
const APPLE_ID = /^[0-9]{1,20}$/;

// Key segment <-> MusicKit/catalog kind.
const KIND_BY_SEGMENT = Object.freeze({ video: 'musicVideo', song: 'song' });
const SEGMENT_BY_KIND = Object.freeze({ musicVideo: 'video', song: 'song' });

// The catalog API path segment for each kind.
const CATALOG_TYPE_BY_KIND = Object.freeze({ musicVideo: 'music-videos', song: 'songs' });

/**
 * @returns {{provider: 'youtube', id: string} |
 *           {provider: 'apple', kind: 'musicVideo'|'song', id: string} | null}
 */
function parseTrackKey(key) {
    if (typeof key !== 'string') return null;
    if (YOUTUBE_ID.test(key)) return { provider: 'youtube', id: key };
    const match = APPLE_KEY.exec(key);
    if (match) return { provider: 'apple', kind: KIND_BY_SEGMENT[match[1]], id: match[2] };
    return null;
}

function appleTrackKey(kind, id) {
    const segment = SEGMENT_BY_KIND[kind];
    const catalogId = String(id);
    if (!segment) throw new Error(`Unknown Apple Music kind: ${kind}`);
    if (!APPLE_ID.test(catalogId)) throw new Error(`Not an Apple Music catalog id: ${catalogId}`);
    return `am:${segment}:${catalogId}`;
}

function providerOfKey(key) {
    const parsed = parseTrackKey(key);
    return parsed ? parsed.provider : null;
}

function isProvider(value) {
    return PROVIDERS.includes(value);
}

module.exports = {
    PROVIDERS,
    CATALOG_TYPE_BY_KIND,
    parseTrackKey,
    appleTrackKey,
    providerOfKey,
    isProvider,
};
