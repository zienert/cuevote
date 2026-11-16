// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { BUDGETS, createTokenBuckets } = require('../limits');

function clock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  now.set = (ms) => { t = ms; };
  return now;
}

describe('token buckets', () => {
  it('allows a burst up to capacity, then one per refill interval', () => {
    const now = clock();
    const buckets = createTokenBuckets({ capacity: 5, windowMs: 60_000 }, { now });
    for (let i = 0; i < 5; i++) assert.equal(buckets.take('a'), true, `take ${i + 1}`);
    assert.equal(buckets.take('a'), false, 'the sixth is refused');
    assert.equal(buckets.waitMs('a'), 12_000, 'one token comes back every 12 s');

    now.advance(11_999);
    assert.equal(buckets.take('a'), false);
    assert.equal(buckets.waitMs('a'), 1);
    now.advance(1);
    assert.equal(buckets.waitMs('a'), 0);
    assert.equal(buckets.take('a'), true);
    assert.equal(buckets.take('a'), false);
  });

  it('keeps keys apart', () => {
    const buckets = createTokenBuckets({ capacity: 1, windowMs: 1000 }, { now: clock() });
    assert.equal(buckets.take('a'), true);
    assert.equal(buckets.take('a'), false);
    assert.equal(buckets.take('b'), true);
  });

  it('gives a refunded token back, never beyond capacity', () => {
    const now = clock();
    const buckets = createTokenBuckets({ capacity: 2, windowMs: 60_000 }, { now });
    buckets.take('a');
    buckets.take('a');
    buckets.refund('a');
    assert.equal(buckets.take('a'), true);
    assert.equal(buckets.take('a'), false);

    buckets.refund('a');
    buckets.refund('a');
    buckets.refund('a');
    assert.equal(buckets.take('a'), true);
    assert.equal(buckets.take('a'), true);
    assert.equal(buckets.take('a'), false, 'three refunds still make only two tokens');

    buckets.refund('never-seen');
    assert.equal(buckets.size, 1, 'refunding an unknown key stores nothing');
  });

  it('counts refusals in a row, starting over after a successful take', () => {
    const now = clock();
    const buckets = createTokenBuckets({ capacity: 1, windowMs: 1000 }, { now });
    buckets.take('a');
    assert.equal(buckets.noteDenied('a'), 1);
    assert.equal(buckets.noteDenied('a'), 2);
    now.advance(1000);
    assert.equal(buckets.take('a'), true);
    assert.equal(buckets.noteDenied('a'), 1);
  });

  it('forgets keys that have refilled, and only those', () => {
    const now = clock();
    const buckets = createTokenBuckets({ capacity: 5, windowMs: 60_000 }, { now });
    buckets.take('a');
    now.advance(30_000);
    buckets.take('b');
    buckets.take('b');
    assert.equal(buckets.size, 2);
    now.advance(12_000); // a is full again, b is one token short
    buckets.prune();
    assert.equal(buckets.size, 1);
    assert.equal(buckets.waitMs('b'), 0);
  });

  it('does not refill when the clock steps back', () => {
    const now = clock(100_000);
    const buckets = createTokenBuckets({ capacity: 1, windowMs: 60_000 }, { now });
    buckets.take('a');
    now.set(40_000);
    assert.equal(buckets.take('a'), false);
    assert.ok(buckets.waitMs('a') > 0);
  });
});

describe('budget table', () => {
  it('limits room password guesses to 5 per network and 30 per room each minute', () => {
    assert.deepEqual(BUDGETS.roomPasswordPerNet, { capacity: 5, windowMs: 60_000 });
    assert.deepEqual(BUDGETS.roomPasswordPerRoom, { capacity: 30, windowMs: 60_000 });
  });
});
