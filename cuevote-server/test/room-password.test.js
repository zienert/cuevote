// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createAttemptBudget, createSemaphore, createRoomPasswordGuard } = require('../room-password');

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

// A stand-in for bcrypt that answers after a timer tick, like the real one
// hands the event loop back, and records how many checks overlap.
function fakeBcrypt(rightPassword) {
  const fake = { compares: 0, hashes: 0, inFlight: 0, maxInFlight: 0 };
  const work = (result) => {
    fake.inFlight++;
    fake.maxInFlight = Math.max(fake.maxInFlight, fake.inFlight);
    return new Promise((resolve) => setTimeout(() => {
      fake.inFlight--;
      resolve(result);
    }, 2));
  };
  fake.compare = (password) => {
    fake.compares++;
    return work(password === rightPassword);
  };
  fake.hash = (password) => {
    fake.hashes++;
    return work(`hashed:${password}`);
  };
  return fake;
}

describe('semaphore', () => {
  it('runs at most the limit at once, in the order asked', async () => {
    const gate = createSemaphore(2);
    const started = [];
    let running = 0;
    let maxRunning = 0;
    const task = (n) => async () => {
      started.push(n);
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running--;
      return n;
    };
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => gate.run(task(n))));
    assert.deepEqual(results, [1, 2, 3, 4, 5]);
    assert.deepEqual(started, [1, 2, 3, 4, 5]);
    assert.equal(maxRunning, 2);
    assert.equal(gate.running, 0);
    assert.equal(gate.waiting, 0);
  });

  it('passes a failure on and frees the slot', async () => {
    const gate = createSemaphore(1);
    await assert.rejects(gate.run(async () => { throw new Error('boom'); }), /boom/);
    assert.equal(await gate.run(async () => 'next'), 'next');
    assert.equal(gate.running, 0);
  });
});

describe('room password guard', () => {
  const ROOM = { netKey: '203.0.113.7', roomId: 'room-a', passwordHash: 'stored-hash' };

  it('tells right from wrong passwords', async () => {
    const bcrypt = fakeBcrypt('secret');
    const guard = createRoomPasswordGuard({ compare: bcrypt.compare, hash: bcrypt.hash });
    assert.deepEqual(await guard.verify({ ...ROOM, password: 'secret' }), { ok: true });
    assert.deepEqual(await guard.verify({ ...ROOM, password: 'nope' }), { ok: false, reason: 'wrong' });
  });

  it('refuses the sixth wrong password of a network without running bcrypt', async () => {
    const bcrypt = fakeBcrypt('secret');
    const guard = createRoomPasswordGuard({ compare: bcrypt.compare, hash: bcrypt.hash });
    for (let i = 0; i < 5; i++) {
      assert.equal((await guard.verify({ ...ROOM, password: `nope-${i}` })).reason, 'wrong');
    }
    const sixth = await guard.verify({ ...ROOM, password: 'nope-5' });
    assert.equal(sixth.reason, 'limited');
    assert.equal(sixth.scope, 'net');
    assert.equal(bcrypt.compares, 5);

    const right = await guard.verify({ ...ROOM, password: 'secret' });
    assert.equal(right.reason, 'limited', 'over budget, even the right password is not checked');
    assert.equal(bcrypt.compares, 5);
    assert.deepEqual(await guard.verify({ ...ROOM, netKey: '198.51.100.1', password: 'secret' }), { ok: true });
  });

  it('runs bcrypt five times for ten wrong passwords sent at once', async () => {
    const bcrypt = fakeBcrypt('secret');
    const guard = createRoomPasswordGuard({ compare: bcrypt.compare, hash: bcrypt.hash });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => guard.verify({ ...ROOM, password: `nope-${i}` })),
    );
    assert.equal(results.filter((r) => r.reason === 'wrong').length, 5);
    assert.equal(results.filter((r) => r.reason === 'limited').length, 5);
    assert.equal(bcrypt.compares, 5);
    assert.ok(bcrypt.maxInFlight <= 2, `at most two at once, saw ${bcrypt.maxInFlight}`);
  });

  it('lets a crowd behind one router in at once when they know the password', async () => {
    const bcrypt = fakeBcrypt('secret');
    const guard = createRoomPasswordGuard({ compare: bcrypt.compare, hash: bcrypt.hash });
    const results = await Promise.all(
      Array.from({ length: 30 }, () => guard.verify({ ...ROOM, password: 'secret' })),
    );
    assert.ok(results.every((r) => r.ok), 'nobody is refused');
    assert.equal(bcrypt.compares, 30);
    assert.equal(bcrypt.maxInFlight, 2);
  });

  it('does not charge a guess when bcrypt itself fails', async () => {
    let calls = 0;
    const guard = createRoomPasswordGuard({
      compare: async () => {
        calls++;
        throw new Error('Invalid salt version');
      },
    });
    for (let i = 0; i < 7; i++) {
      await assert.rejects(guard.verify({ ...ROOM, password: 'x' }), /Invalid salt/);
    }
    assert.equal(calls, 7, 'failures of ours are not counted against the network');
  });

  it('hashes new passwords in line with the checks', async () => {
    const bcrypt = fakeBcrypt('secret');
    const guard = createRoomPasswordGuard({ compare: bcrypt.compare, hash: bcrypt.hash });
    const work = [
      guard.hash('one'),
      guard.verify({ ...ROOM, password: 'secret' }),
      guard.hash('two'),
      guard.verify({ ...ROOM, password: 'nope' }),
    ];
    const [one, , two] = await Promise.all(work);
    assert.equal(one, 'hashed:one');
    assert.equal(two, 'hashed:two');
    assert.equal(bcrypt.maxInFlight, 2);
  });

  it('uses bcrypt by default', async () => {
    const bcryptjs = require('bcryptjs');
    const guard = createRoomPasswordGuard();
    const passwordHash = await guard.hash('party-4711');
    assert.equal(bcryptjs.getRounds(passwordHash), 10);
    assert.deepEqual(await guard.verify({ ...ROOM, passwordHash, password: 'party-4711' }), { ok: true });
    assert.deepEqual(await guard.verify({ ...ROOM, passwordHash, password: 'party-4712' }), { ok: false, reason: 'wrong' });
  });
});
