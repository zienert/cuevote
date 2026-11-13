// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
//
// Track keys, as the server writes them into `videoId` (see
// cuevote-server/track-keys.js):
//
//   dQw4w9WgXcQ            YouTube video
//   am:video:1258705880    Apple Music music video
//   am:song:1440899467     Apple Music song

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const APPLE_KEY = /^am:(video|song):([0-9]{1,20})$/;
const KIND_BY_SEGMENT = { video: 'musicVideo', song: 'song' };

/**
 * @returns {{provider: 'youtube', id: string} |
 *           {provider: 'apple', kind: 'musicVideo'|'song', id: string} | null}
 */
export function parseTrackKey(key) {
    if (typeof key !== 'string') return null;
    if (YOUTUBE_ID.test(key)) return { provider: 'youtube', id: key };
    const match = APPLE_KEY.exec(key);
    if (match) return { provider: 'apple', kind: KIND_BY_SEGMENT[match[1]], id: match[2] };
    return null;
}

export function isAppleKey(key) {
    return typeof key === 'string' && APPLE_KEY.test(key);
}

export function isYouTubeKey(key) {
    return typeof key === 'string' && YOUTUBE_ID.test(key);
}
