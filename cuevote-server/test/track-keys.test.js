// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  PROVIDERS,
  CATALOG_TYPE_BY_KIND,
  parseTrackKey,
  appleTrackKey,
  providerOfKey,
  isProvider,
} = require('../track-keys');

describe('track keys', () => {
  it('reads a bare 11-character id as a YouTube video', () => {
    assert.deepEqual(parseTrackKey('dQw4w9WgXcQ'), { provider: 'youtube', id: 'dQw4w9WgXcQ' });
  });

  it('reads Apple Music music videos and songs', () => {
    assert.deepEqual(parseTrackKey('am:video:1258705880'), { provider: 'apple', kind: 'musicVideo', id: '1258705880' });
    assert.deepEqual(parseTrackKey('am:song:1440899467'), { provider: 'apple', kind: 'song', id: '1440899467' });
  });

  it('rejects everything else', () => {
    for (const key of [
      undefined, null, 42, '', 'dQw4w9WgXc', 'dQw4w9WgXcQQ', 'dQw4w9Wg Q',
      'am:video:', 'am:video:12a4', 'am:album:1440899467', 'am:song:1440899467 ',
      'am:video:' + '1'.repeat(21), 'yt:dQw4w9WgXcQ', 'https://music.apple.com/x',
    ]) {
      assert.equal(parseTrackKey(key), null, `should reject ${JSON.stringify(key)}`);
    }
  });

  it('builds Apple keys that parse back', () => {
    assert.equal(appleTrackKey('musicVideo', '1258705880'), 'am:video:1258705880');
    assert.equal(appleTrackKey('song', 1440899467), 'am:song:1440899467');
    const parsed = parseTrackKey(appleTrackKey('musicVideo', '1258705880'));
    assert.equal(parsed.kind, 'musicVideo');
    assert.equal(CATALOG_TYPE_BY_KIND[parsed.kind], 'music-videos');
  });

  it('refuses to build keys from unknown kinds or ids', () => {
    assert.throws(() => appleTrackKey('album', '1'), /Unknown Apple Music kind/);
    assert.throws(() => appleTrackKey('song', 'abc'), /Not an Apple Music catalog id/);
  });

  it('keeps Apple keys within the 50-character wire limit', () => {
    assert.ok(appleTrackKey('musicVideo', '9'.repeat(20)).length <= 50);
  });

  it('names the provider of a key', () => {
    assert.equal(providerOfKey('dQw4w9WgXcQ'), 'youtube');
    assert.equal(providerOfKey('am:song:1'), 'apple');
    assert.equal(providerOfKey('nope'), null);
    assert.deepEqual([...PROVIDERS], ['youtube', 'apple']);
    assert.ok(isProvider('apple'));
    assert.ok(!isProvider('spotify'));
  });
});
