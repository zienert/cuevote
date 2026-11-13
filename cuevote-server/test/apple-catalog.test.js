// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  createAppleCatalog,
  parseAppleMusicLink,
  isStorefront,
  toTrack,
} = require('../apple-catalog');

function video(id, name = 'New Rules', overrides = {}) {
  return {
    id: String(id),
    type: 'music-videos',
    attributes: {
      name,
      artistName: 'Dua Lipa',
      durationInMillis: 221000,
      artwork: { url: 'https://is1-ssl.mzstatic.com/image/thumb/x/{w}x{h}bb.jpg', width: 1920, height: 1080 },
      playParams: { id: String(id), kind: 'musicVideo' },
      ...overrides,
    },
  };
}

function song(id, name = 'Levitating', overrides = {}) {
  return {
    id: String(id),
    type: 'songs',
    attributes: {
      name,
      artistName: 'Dua Lipa',
      durationInMillis: 203064,
      artwork: { url: 'https://is1-ssl.mzstatic.com/image/thumb/y/{w}x{h}bb.jpg', width: 3000, height: 3000 },
      playParams: { id: String(id), kind: 'song' },
      contentRating: 'explicit',
      ...overrides,
    },
  };
}

// A fetch stand-in that records requests and answers from a function.
function fakeFetch(answer) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url: new URL(url), options });
    const result = answer(new URL(url));
    if (result instanceof Error) throw result;
    const { status = 200, body = {} } = result;
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  impl.calls = calls;
  return impl;
}

const getToken = () => ({ token: 'test-token' });

describe('Apple Music catalog', () => {
  describe('parseAppleMusicLink', () => {
    it('reads music video, song and album-track links', () => {
      assert.deepEqual(parseAppleMusicLink('https://music.apple.com/nl/music-video/new-rules/1258705880'), { kind: 'musicVideo', id: '1258705880' });
      assert.deepEqual(parseAppleMusicLink('https://music.apple.com/us/song/levitating/1538003843'), { kind: 'song', id: '1538003843' });
      assert.deepEqual(parseAppleMusicLink('https://music.apple.com/us/album/levitating/1538003494?i=1538003843'), { kind: 'song', id: '1538003843' });
      assert.deepEqual(parseAppleMusicLink(' https://music.apple.com/de/music-video/1258705880 '), { kind: 'musicVideo', id: '1258705880' });
    });

    it('ignores everything else', () => {
      for (const input of [
        'New Rules', 'https://music.apple.com/us/album/levitating/1538003494',
        'https://music.apple.com/us/artist/dua-lipa/1031397873', 'https://evil.example/us/song/x/1',
        'https://music.apple.com.evil.example/us/song/x/1', 'javascript:alert(1)',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://music.apple.com/usa/song/x/1', null,
      ]) {
        assert.equal(parseAppleMusicLink(input), null, `should ignore ${input}`);
      }
    });
  });

  describe('toTrack', () => {
    it('maps music videos and songs to room tracks', () => {
      assert.deepEqual(toTrack(video(1258705880)), {
        videoId: 'am:video:1258705880',
        provider: 'apple',
        kind: 'musicVideo',
        title: 'New Rules',
        artist: 'Dua Lipa',
        thumbnail: 'https://is1-ssl.mzstatic.com/image/thumb/x/640x360bb.jpg',
        duration: 221,
        explicit: false,
      });
      const track = toTrack(song(1538003843));
      assert.equal(track.videoId, 'am:song:1538003843');
      assert.equal(track.thumbnail, 'https://is1-ssl.mzstatic.com/image/thumb/y/600x600bb.jpg');
      assert.equal(track.duration, 203);
      assert.equal(track.explicit, true);
    });

    it('drops what cannot be played', () => {
      assert.equal(toTrack(video(1, 'x', { playParams: undefined })), null);
      assert.equal(toTrack(video(1, 'x', { durationInMillis: 0 })), null);
      assert.equal(toTrack({ id: '1', type: 'albums', attributes: {} }), null);
      assert.equal(toTrack(video('abc')), null);
    });
  });

  describe('search', () => {
    it('asks the storefront for music videos and songs with the token', async () => {
      const fetchImpl = fakeFetch(() => ({
        body: { results: { 'music-videos': { data: [video(1258705880), video(1, 'No play', { playParams: undefined })] }, songs: { data: [song(1538003843)] } } },
      }));
      const catalog = createAppleCatalog({ getToken, fetchImpl });
      const result = await catalog.search('nl', '  dua lipa new rules ', { limit: 3 });
      assert.deepEqual(result.videos.map(t => t.videoId), ['am:video:1258705880']);
      assert.deepEqual(result.songs.map(t => t.videoId), ['am:song:1538003843']);
      const { url, options } = fetchImpl.calls[0];
      assert.equal(url.origin + url.pathname, 'https://api.music.apple.com/v1/catalog/nl/search');
      assert.equal(url.searchParams.get('term'), 'dua lipa new rules');
      assert.equal(url.searchParams.get('types'), 'music-videos,songs');
      assert.equal(url.searchParams.get('limit'), '3');
      assert.equal(options.headers.Authorization, 'Bearer test-token');
    });

    it('does not call Apple for an empty term and refuses bad storefronts', async () => {
      const fetchImpl = fakeFetch(() => ({ body: {} }));
      const catalog = createAppleCatalog({ getToken, fetchImpl });
      assert.deepEqual(await catalog.search('nl', '   '), { videos: [], songs: [] });
      assert.equal(fetchImpl.calls.length, 0);
      await assert.rejects(catalog.search('NL', 'x'), { code: 'APPLE_CATALOG_BAD_STOREFRONT' });
      await assert.rejects(catalog.search('nl/../us', 'x'), { code: 'APPLE_CATALOG_BAD_STOREFRONT' });
    });
  });

  describe('lookup', () => {
    it('looks up each kind separately and skips other keys', async () => {
      const fetchImpl = fakeFetch((url) => {
        if (url.pathname.endsWith('/music-videos')) return { body: { data: [video(1258705880)] } };
        if (url.pathname.endsWith('/songs')) return { body: { data: [song(1538003843)] } };
        return { status: 404 };
      });
      const catalog = createAppleCatalog({ getToken, fetchImpl });
      const found = await catalog.lookup('de', ['am:video:1258705880', 'am:song:1538003843', 'am:song:999', 'dQw4w9WgXcQ', 'am:video:1258705880']);
      assert.deepEqual([...found.keys()].sort(), ['am:song:1538003843', 'am:video:1258705880']);
      assert.equal(fetchImpl.calls.length, 2);
      const videoCall = fetchImpl.calls.find(c => c.url.pathname === '/v1/catalog/de/music-videos');
      assert.equal(videoCall.url.searchParams.get('ids'), '1258705880');
      const songCall = fetchImpl.calls.find(c => c.url.pathname === '/v1/catalog/de/songs');
      assert.equal(songCall.url.searchParams.get('ids'), '1538003843,999');
    });

    it('splits long lists into chunks of 25 ids', async () => {
      const fetchImpl = fakeFetch(() => ({ body: { data: [] } }));
      const catalog = createAppleCatalog({ getToken, fetchImpl });
      const keys = Array.from({ length: 30 }, (_, i) => `am:video:${1000 + i}`);
      await catalog.lookup('us', keys);
      assert.deepEqual(fetchImpl.calls.map(c => c.url.searchParams.get('ids').split(',').length), [25, 5]);
    });

    it('makes no request without Apple keys', async () => {
      const fetchImpl = fakeFetch(() => ({ body: {} }));
      const catalog = createAppleCatalog({ getToken, fetchImpl });
      assert.equal((await catalog.lookup('us', ['dQw4w9WgXcQ'])).size, 0);
      assert.equal(fetchImpl.calls.length, 0);
    });
  });

  describe('errors', () => {
    it('names rate limits, rejected tokens, outages and other failures', async () => {
      const cases = [
        [{ status: 429 }, 'APPLE_CATALOG_RATE_LIMITED'],
        [{ status: 401 }, 'APPLE_CATALOG_UNAUTHORIZED'],
        [{ status: 403 }, 'APPLE_CATALOG_UNAUTHORIZED'],
        [{ status: 500 }, 'APPLE_CATALOG_ERROR'],
        [new Error('ECONNRESET'), 'APPLE_CATALOG_UNREACHABLE'],
      ];
      for (const [answer, code] of cases) {
        const catalog = createAppleCatalog({ getToken, fetchImpl: fakeFetch(() => answer) });
        await assert.rejects(catalog.search('us', 'x'), { code });
      }
    });
  });

  it('knows a storefront when it sees one', () => {
    assert.ok(isStorefront('nl'));
    assert.ok(!isStorefront('NL'));
    assert.ok(!isStorefront('nld'));
    assert.ok(!isStorefront(undefined));
  });
});
