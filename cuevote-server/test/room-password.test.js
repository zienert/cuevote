// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createAttemptBudget } = require('../room-password');

function clock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

describe('room password attempt budget', () => {
  it('lets a network guess five times a minute, then refuses with a wait', () => {
    const now = clock();
    const budget = createAttemptBudget({ now });
    for (let i = 0; i < 5; i++) assert.equal(budget.spend('203.0.113.7', 'room-a').ok, true);

    const refused = budget.spend('203.0.113.7', 'room-a');
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, 'limited');
    assert.equal(refused.scope, 'net');
    assert.equal(refused.retryAfter, 12);
    assert.equal(refused.firstDenial, true);
    assert.equal(budget.spend('203.0.113.7', 'room-a').firstDenial, false, 'a run of refusals is reported once');

    now.advance(12_000);
    assert.equal(budget.spend('203.0.113.7', 'room-a').ok, true, 'one guess is back after 12 s');
  });

  it('applies the network budget across rooms', () => {
    const budget = createAttemptBudget({ now: clock() });
    for (let i = 0; i < 5; i++) budget.spend('203.0.113.7', `room-${i}`);
    assert.equal(budget.spend('203.0.113.7', 'room-9').ok, false);
    assert.equal(budget.spend('198.51.100.1', 'room-9').ok, true, 'another network is not affected');
  });

  it('gives a right password its guess back', () => {
    const budget = createAttemptBudget({ now: clock() });
    for (let i = 0; i < 50; i++) {
      const attempt = budget.spend('203.0.113.7', 'room-a');
      assert.equal(attempt.ok, true, `join ${i + 1}`);
      attempt.refund();
    }
  });

  it('refunds a guess only once', () => {
    const budget = createAttemptBudget({ now: clock() });
    const attempt = budget.spend('203.0.113.7', 'room-a');
    attempt.refund();
    attempt.refund();
    for (let i = 0; i < 5; i++) assert.equal(budget.spend('203.0.113.7', 'room-a').ok, true);
    assert.equal(budget.spend('203.0.113.7', 'room-a').ok, false);
  });

  it('lets a room be guessed at 30 times a minute across all networks', () => {
    const budget = createAttemptBudget({ now: clock() });
    for (let n = 0; n < 6; n++) {
      for (let i = 0; i < 5; i++) assert.equal(budget.spend(`198.51.100.${n}`, 'room-a').ok, true);
    }
    const refused = budget.spend('198.51.100.200', 'room-a');
    assert.equal(refused.ok, false);
    assert.equal(refused.scope, 'room');
    assert.equal(refused.retryAfter, 2, 'one guess per 2 s comes back to the room');
    assert.equal(budget.spend('198.51.100.200', 'room-b').ok, true, 'other rooms are not affected');
  });

  it('spends nothing when it refuses', () => {
    const budget = createAttemptBudget({ now: clock() });
    for (let n = 0; n < 6; n++) {
      for (let i = 0; i < 5; i++) budget.spend(`198.51.100.${n}`, 'room-a');
    }
    // The room is out. A fresh network trying it must keep its own five
    // guesses for other rooms.
    for (let i = 0; i < 3; i++) assert.equal(budget.spend('203.0.113.7', 'room-a').ok, false);
    for (let i = 0; i < 5; i++) assert.equal(budget.spend('203.0.113.7', 'room-b').ok, true);
  });

  it('says how long until both the network and the room can guess again', () => {
    const now = clock();
    const budget = createAttemptBudget({ perNet: { capacity: 1, windowMs: 10_000 }, perRoom: { capacity: 1, windowMs: 60_000 }, now });
    budget.spend('203.0.113.7', 'room-a');
    const refused = budget.spend('203.0.113.7', 'room-a');
    assert.equal(refused.scope, 'room');
    assert.equal(refused.retryAfter, 60);
  });

  it('forgets networks and rooms whose budget is full again', () => {
    const now = clock();
    const budget = createAttemptBudget({ now });
    for (let i = 0; i < 5; i++) budget.spend('203.0.113.7', 'room-a');
    now.advance(60_000);
    budget.prune();
    for (let i = 0; i < 5; i++) assert.equal(budget.spend('203.0.113.7', 'room-a').ok, true);
  });
});
