// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sortUpcoming, AUTO_DJ } = require('../queue-order');

const track = (id, score = 0, extra = {}) => ({ id, score, ...extra });
const ids = (queue) => queue.map((t) => t.id);

describe('sortUpcoming', () => {
  it('never moves the head — it is the track that is playing', () => {
    const queue = [track('playing', -99), track('a', 1), track('b', 5)];
    assert.equal(sortUpcoming(queue)[0].id, 'playing');
  });

  it('orders the rest by score, highest first', () => {
    const queue = [track('playing'), track('low', 1), track('high', 9), track('mid', 5)];
    assert.deepEqual(ids(sortUpcoming(queue)), ['playing', 'high', 'mid', 'low']);
  });

  it('puts an owner priority pick ahead of a better-scored track', () => {
    const queue = [track('playing'), track('popular', 50), track('pinned', 0, { isOwnerPriority: true })];
    assert.deepEqual(ids(sortUpcoming(queue)), ['playing', 'pinned', 'popular']);
  });

  it('orders several priority picks among themselves by score', () => {
    const queue = [
      track('playing'),
      track('pinned-low', 1, { isOwnerPriority: true }),
      track('normal', 99),
      track('pinned-high', 7, { isOwnerPriority: true }),
    ];
    assert.deepEqual(ids(sortUpcoming(queue)), ['playing', 'pinned-high', 'pinned-low', 'normal']);
  });

  it('keeps arrival order for equal scores, so equal votes stay first-come', () => {
    const queue = [track('playing'), track('first', 3), track('second', 3), track('third', 3)];
    assert.deepEqual(ids(sortUpcoming(queue)), ['playing', 'first', 'second', 'third']);
  });

  it('plays the songs people asked for before the Auto-DJ picks queued earlier', () => {
    const queue = [
      track('playing'),
      track('mix-1', 0, { suggestedBy: AUTO_DJ }),
      track('mix-2', 0, { suggestedBy: AUTO_DJ }),
      track('asked', 0, { suggestedBy: 'user-1' }),
    ];
    assert.deepEqual(ids(sortUpcoming(queue)), ['playing', 'asked', 'mix-1', 'mix-2']);
  });

  it('keeps a voted-up Auto-DJ pick behind a song someone asked for', () => {
    const queue = [track('playing'), track('mix', 5, { suggestedBy: AUTO_DJ }), track('asked', 0, { suggestedBy: 'user-1' })];
    assert.deepEqual(ids(sortUpcoming(queue)), ['playing', 'asked', 'mix']);
  });

  it('orders the Auto-DJ picks among themselves by score', () => {
    const queue = [
      track('playing'),
      track('mix-low', 0, { suggestedBy: AUTO_DJ }),
      track('mix-high', 2, { suggestedBy: AUTO_DJ }),
    ];
    assert.deepEqual(ids(sortUpcoming(queue)), ['playing', 'mix-high', 'mix-low']);
  });

  it('treats a missing score as zero', () => {
    const queue = [track('playing'), { id: 'no-score' }, track('negative', -1), track('positive', 1)];
    assert.deepEqual(ids(sortUpcoming(queue)), ['playing', 'positive', 'no-score', 'negative']);
  });

  it('does not mutate the queue it was given', () => {
    const queue = [track('playing'), track('a', 1), track('b', 5)];
    const snapshot = ids(queue);
    sortUpcoming(queue);
    assert.deepEqual(ids(queue), snapshot);
  });

  it('returns a copy, not the same array', () => {
    const queue = [track('playing'), track('a', 1)];
    assert.notEqual(sortUpcoming(queue), queue);
  });

  it('handles a queue too short to order', () => {
    assert.deepEqual(sortUpcoming([]), []);
    assert.deepEqual(ids(sortUpcoming([track('only')])), ['only']);
  });

  it('passes a non-array through untouched rather than inventing a queue', () => {
    assert.equal(sortUpcoming(undefined), undefined);
    assert.equal(sortUpcoming(null), null);
  });
});
