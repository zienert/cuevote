// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  bestMatch,
  createAppleCatalog,
  isAppleMusicPage,
  looksLikeLink,
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

    it('reads share, embed and old iTunes links and an upper-case storefront', () => {
      assert.deepEqual(parseAppleMusicLink('https://geo.music.apple.com/NL/song/levitating/1538003843'), { kind: 'song', id: '1538003843' });
      assert.deepEqual(parseAppleMusicLink('https://embed.music.apple.com/nl/music-video/new-rules/1258705880'), { kind: 'musicVideo', id: '1258705880' });
      assert.deepEqual(parseAppleMusicLink('https://itunes.apple.com/us/album/levitating/id1538003494?i=1538003843'), { kind: 'song', id: '1538003843' });
    });

    it('tells links from titles, and Apple pages that are not a song', () => {
      for (const link of ['https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', 'www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtu.be/dQw4w9WgXcQ', 'https://apple.co/3xYz']) {
        assert.equal(looksLikeLink(link), true, link);
      }
      for (const title of ['New Rules', 'Still D.R.E.', 'AC/DC Thunderstruck', 'Mr. Brightside']) {
        assert.equal(looksLikeLink(title), false, title);
      }
      assert.equal(isAppleMusicPage('https://music.apple.com/us/album/levitating/1538003494'), true);
      assert.equal(isAppleMusicPage('https://apple.co/3xYz'), true);
      assert.equal(isAppleMusicPage('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'), false);
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

  describe('equivalents', () => {
    it('finds the id this storefront uses for the same recording, one request per key', async () => {
      const fetchImpl = fakeFetch((url) => {
        const id = url.searchParams.get('filter[equivalents]');
        if (id === '693246512') return { body: { data: [song(1715687117, 'Sexy Bitch (feat. Akon)')] } };
        return { body: { data: [] } };
      });
      const catalog = createAppleCatalog({ getToken, fetchImpl });
      const found = await catalog.equivalents('nl', ['am:song:693246512', 'am:video:1', 'dQw4w9WgXcQ']);
      assert.deepEqual([...found.keys()], ['am:song:693246512']);
      assert.equal(found.get('am:song:693246512').videoId, 'am:song:1715687117');
      assert.deepEqual(fetchImpl.calls.map(c => c.url.pathname), ['/v1/catalog/nl/songs', '/v1/catalog/nl/music-videos']);
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

  // Titles as Apple's nl storefront returned them in November 2026.
  describe('bestMatch', () => {
    const v = (title, artist = 'Dua Lipa') => ({ videoId: `am:video:${title}`, kind: 'musicVideo', title, artist });
    const s = (title, artist = 'Dua Lipa') => ({ videoId: `am:song:${title}`, kind: 'song', title, artist });
    const levitating = [
      v('Levitating (feat. Madonna and Missy Elliott) [The Blessed Madonna Remix]'),
      v('Levitating (feat. DaBaby)'),
      v('Levitating (Lyric Video)'),
      v('Levitating (Live From Mexico)'),
      v('New Rules'),
    ];

    it('prefers the original music video over remixes, lyric and live videos', () => {
      const pick = bestMatch('Dua Lipa Levitating', { videos: levitating, songs: [s('Levitating')] });
      assert.equal(pick.videoId, 'am:video:Levitating (feat. DaBaby)');

      const antiHero = bestMatch('Anti-Hero', {
        videos: [v('Anti-Hero (Lyric Video)', 'Taylor Swift'), v('Anti-Hero', 'Taylor Swift')],
        songs: [s('Anti-Hero', 'Taylor Swift')],
      });
      assert.equal(antiHero.videoId, 'am:video:Anti-Hero');
    });

    it('returns nothing when no result is about what was typed', () => {
      const unrelated = { videos: [v('Open Your Eyes', 'Snow Patrol')], songs: [s('Shape of You', 'Ed Sheeran')] };
      assert.equal(bestMatch('Zzyzx Road Dreamland', unrelated), null);
      assert.equal(bestMatch('levitating dua lipa official music video 4k', { videos: levitating }).videoId, 'am:video:Levitating (feat. DaBaby)');
    });

    it('takes a song by the artist named over a song the artist is only featured on', () => {
      const pick = bestMatch('Ed Sheeran', {
        songs: [s('Yours Eternally (feat. Ed Sheeran & Taras Topolia)', 'U2'), s('Shape of You', 'Ed Sheeran')],
      });
      assert.equal(pick.artist, 'Ed Sheeran');
    });

    it('forgives typos and half-typed words', () => {
      const queen = { videos: [v('Bohemian Rhapsody (Remastered)', 'Queen')], songs: [s('Bohemian Rhapsody', 'Queen')] };
      assert.equal(bestMatch('Bohemain Rapsody', queen).videoId, 'am:video:Bohemian Rhapsody (Remastered)');
      assert.equal(bestMatch('levit', { videos: levitating }).videoId, 'am:video:Levitating (feat. DaBaby)');
      assert.equal(bestMatch('Still Dre', { videos: [v('Still D.R.E. (feat. Snoop Dogg)', 'Dr. Dre')] }).artist, 'Dr. Dre');
    });

    it('prefers the original video over a numbered alternate, but not over a single version', () => {
      const brightside = bestMatch('Mr Brightside', {
        videos: [v('Mr. Brightside (Version 2)', 'The Killers'), v('Mr. Brightside', 'The Killers')],
        songs: [s('Mr. Brightside', 'The Killers')],
      });
      assert.equal(brightside.videoId, 'am:video:Mr. Brightside');

      const single = bestMatch('New Rules', { videos: [v('New Rules (Single Version)'), v('New Rules (Live)')] });
      assert.equal(single.videoId, 'am:video:New Rules (Single Version)');
    });

    it('gives a remix, a live or a lyric video to whoever asks for one', () => {
      assert.match(bestMatch('levitating remix', { videos: levitating }).title, /Remix/);
      assert.equal(bestMatch('levitating lyrics', { videos: levitating }).title, 'Levitating (Lyric Video)');
      const atemlos = bestMatch('Atemlos live', {
        videos: [
          v('Atemlos durch die Nacht', 'Helene Fischer'),
          v('Atemlos durch die Nacht (Regen-Version / Live in Berlin 2015)', 'Helene Fischer'),
          v('Atemlos durch die Nacht (Live in München, 2022)', 'Helene Fischer'),
        ],
      });
      assert.equal(atemlos.title, 'Atemlos durch die Nacht (Live in München, 2022)');
    });

    it('takes the song asked for over a music video of another one', () => {
      const pick = bestMatch('Dua Lipa Levitating', {
        videos: [v('New Rules'), v('One Kiss', 'Calvin Harris & Dua Lipa')],
        songs: [s('Levitating')],
      });
      assert.equal(pick.videoId, 'am:song:Levitating');

      const physical = bestMatch('Olivia Newton-John Physical', {
        videos: [v('Physical')],
        songs: [s('Physical (Remastered 2021)', 'Olivia Newton-John')],
      });
      assert.equal(physical.artist, 'Olivia Newton-John');
    });

    it('prefers the original artist over a cover and the song over a special edition', () => {
      const rhapsody = bestMatch('Bohemian Rhapsody', {
        videos: [
          v('Bohemian Rhapsody (Live)', 'Queen'),
          v('Bohemian Rhapsody', 'Pentatonix'),
          v('Bohemian Rhapsody (Remastered)', 'Queen'),
        ],
        songs: [s('Bohemian Rhapsody', 'Queen')],
      });
      assert.equal(rhapsody.videoId, 'am:video:Bohemian Rhapsody (Remastered)');

      const caroline = bestMatch('Sweet Caroline', {
        videos: [
          v('Sweet Caroline (Live At The Greek Theatre / 2012)', 'Neil Diamond'),
          v('Sweet Caroline (Hands Washing Hands)', 'Neil Diamond'),
        ],
        songs: [s('Sweet Caroline', 'Neil Diamond')],
      });
      assert.equal(caroline.videoId, 'am:song:Sweet Caroline');
    });

    it('takes the original song over a cover video, and the most common artist as the original', () => {
      const skandal = bestMatch('Skandal im Sperrbezirk', {
        videos: [v('Skandal im Sperrbezirk', 'Eisbrecher')],
        songs: [s('Skandal im Sperrbezirk', 'Spider Murphy Gang'), s('Skandal im Sperrbezirk (Remastered)', 'Spider Murphy Gang')],
      });
      assert.equal(skandal.artist, 'Spider Murphy Gang');

      const physical = bestMatch('Physical', {
        videos: [v('Physical'), v('Physical (Directors Cut)')],
        songs: [s('Physical (Remastered 2021)', 'Olivia Newton-John'), s('Physical')],
      });
      assert.equal(physical.videoId, 'am:video:Physical');

      const cordula = bestMatch('Cordula Grün', {
        videos: [v('Cordula Grün', 'Die Draufgänger')],
        songs: [s('Cordula Grün', 'Die Draufgänger'), s('Cordula Grün (feat. CNASM)', 'Cordula Grün')],
      });
      assert.equal(cordula.videoId, 'am:video:Cordula Grün');
    });

    it('treats a subtitle as part of the title unless the plain title exists too', () => {
      const stern = bestMatch('Ein Stern', {
        videos: [v('Ein Stern (Bassflow Remix)', 'DJ Ötzi & Nik P.'), v('Ein Stern (Ich find Schlager toll Live / 2020)', 'DJ Ötzi')],
        songs: [
          s('Ein Stern (Der deinen Namen trägt) [Party Mix]', 'DJ Ötzi & Nik P.'),
          s('Ein Stern', 'Maria Levin'),
          s('Ein Stern (der deinen Namen trägt) [Radio Mix]', 'DJ Ötzi & Nik P.'),
        ],
      });
      assert.equal(stern.title, 'Ein Stern (der deinen Namen trägt) [Radio Mix]');
    });

    it('reads radio and single versions as the original and spares "Behind Blue Eyes"', () => {
      assert.equal(bestMatch('Summer', { videos: [v('Summer (Radio Edit)', 'Calvin Harris')], songs: [s('Summer', 'Calvin Harris')] }).kind, 'musicVideo');
      assert.equal(bestMatch('Summer', { videos: [v('Summer (Single Version)', 'Calvin Harris')], songs: [s('Summer', 'Calvin Harris')] }).kind, 'musicVideo');
      assert.equal(bestMatch('Behind Blue Eyes', { videos: [v('Behind Blue Eyes', 'The Who')], songs: [s('Behind Blue Eyes', 'The Who')] }).kind, 'musicVideo');
    });

    it('keeps a lyric video of the right song over the song, a live one not', () => {
      assert.equal(bestMatch('Levitating', { videos: [v('Levitating (Lyric Video)')], songs: [s('Levitating')] }).kind, 'musicVideo');
      assert.equal(bestMatch('Levitating', { videos: [v('Levitating (Live From Mexico)')], songs: [s('Levitating')] }).kind, 'song');
    });

    it('skips live versions and interviews even when the words match nothing', () => {
      const typo = bestMatch('Blindin Lites', {
        videos: [v('Blinding Lights (Jimmy Kimmel Live / 2021)', 'The Weeknd'), v('Blinding Lights', 'The Weeknd')],
        songs: [s('Blinding Lights', 'The Weeknd')],
      });
      assert.equal(typo.videoId, 'am:video:Blinding Lights');
      const artistOnly = bestMatch('Miley Cyrus', {
        videos: [v('Miley: The Zane Lowe Interview', 'Miley Cyrus & Zane Lowe'), v('Flowers', 'Miley Cyrus')],
      });
      assert.equal(artistOnly.title, 'Flowers');
    });

    it('returns null without results', () => {
      assert.equal(bestMatch('anything', { videos: [], songs: [] }), null);
      assert.equal(bestMatch('anything'), null);
    });
  });

  it('knows a storefront when it sees one', () => {
    assert.ok(isStorefront('nl'));
    assert.ok(!isStorefront('NL'));
    assert.ok(!isStorefront('nld'));
    assert.ok(!isStorefront(undefined));
  });
});
