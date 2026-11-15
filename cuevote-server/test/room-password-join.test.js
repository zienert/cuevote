// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
//
// JOIN_ROOM for password-protected rooms, end to end: the real server in a
// child process with a throwaway DB (helpers/server.js). Most rooms here are
// hashed at bcrypt's lowest cost, so the tests count bcrypt calls instead of
// waiting on them; the stored hash, not the server, sets the cost of a check.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const { makeWorkDir, startServer, connect, request, joinRoom, waitFor } = require('./helpers/server');

const OWNER = { id: 'owner-sub', email: 'owner@example.test', name: 'Room Owner', picture: '' };
const OWNER_TOKEN = 'f'.repeat(64);
const RIGHT = 'party-4711';
const wrong = (n) => `wrong-guess-${n}`;

const ROOM = 'pw-room-main';
const ROOM_V6 = 'pw-room-v6';
const ROOM_BURST = 'pw-room-burst';
const ROOM_SLOW = 'pw-room-slow';
const OPEN_ROOM = 'open-room';

const track = (n) => ({
  id: `t-${n}`, videoId: `vid${String(n).padStart(8, '0')}`, title: `Song ${n}`, artist: 'Artist',
  thumbnail: '', duration: 4, score: 0, voters: {}, suggestedBy: OWNER.id, suggestedByUsername: OWNER.name,
});

const codes = (replies) => replies.reduce((count, r) => ({ ...count, [r.code || r.type]: (count[r.code || r.type] || 0) + 1 }), {});

describe('JOIN_ROOM with a room password', () => {
  let dir;
  let server;
  const sockets = [];

  const open = async (ip) => {
    const ws = await connect(server.port, { ip });
    sockets.push(ws);
    return ws;
  };

  // A room's lobby entry, which says whether the room is loaded and running.
  const lobbyEntry = async (roomId, type) => {
    const ws = await open('192.0.2.250');
    const list = await request(ws, { type: 'LIST_ROOMS', payload: { type } }, (m) => m.type === 'ROOM_LIST');
    ws.close();
    return list.payload.find((r) => r.id === roomId);
  };

  const woken = (roomId) => server.logLines().some(
    (line) => typeof line.msg === 'string' && line.msg.startsWith('Waking up idle room') && line.msg.includes(`(${roomId})`),
  );

  before(async () => {
    dir = makeWorkDir();
    const cwd = process.cwd();
    process.chdir(dir); // db.js opens ./cuevote.db
    const db = require('../db');
    process.chdir(cwd);

    db.upsertUser(OWNER);
    db.createSession(OWNER_TOKEN, OWNER.id, Math.floor(Date.now() / 1000) + 3600);
    const room = (id, password, isPublic = 0) => db.createRoom({
      id, name: id, description: 'test', owner_id: OWNER.id, color: 'from-gray-700 to-black', is_public: isPublic, password,
    });
    const cheap = bcrypt.hashSync(RIGHT, 4);
    room(ROOM, cheap);
    room(ROOM_V6, cheap);
    room(ROOM_BURST, cheap);
    // Full cost: the check takes long enough for the client to move on.
    room(ROOM_SLOW, bcrypt.hashSync(RIGHT, 10));
    room(OPEN_ROOM, null, 1);
    // As a room is left when everybody walked out mid-song: saved as playing,
    // so waking it would play the queue to nobody.
    db.saveRoomState(ROOM, { queue: [track(0), track(1)], currentTrack: track(0), progress: 1, isPlaying: true });

    server = await startServer({ cwd: dir });
  });

  after(async () => {
    for (const ws of sockets) ws.terminate();
    if (server) await server.stop();
    // The test's own connection to the DB stays open until the process ends,
    // which is fine for unlinking on macOS and Linux.
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuses the sixth wrong password from one network without running bcrypt', async () => {
    const attacker = await open('203.0.113.10');
    const checksBefore = server.passwordChecks();
    for (let i = 1; i <= 5; i++) {
      const reply = await joinRoom(attacker, ROOM, wrong(i));
      assert.equal(reply.code, 'PASSWORD_REQUIRED', `attempt ${i}`);
    }
    assert.equal(server.passwordChecks() - checksBefore, 5);

    const sixth = await joinRoom(attacker, ROOM, wrong(6));
    assert.equal(sixth.type, 'error');
    assert.equal(sixth.code, 'RATE_LIMITED');
    assert.ok(Number.isInteger(sixth.retryAfter) && sixth.retryAfter >= 1 && sixth.retryAfter <= 12, `retryAfter ${sixth.retryAfter}`);
    assert.equal(server.passwordChecks() - checksBefore, 5, 'the sixth attempt never reached bcrypt');

    const right = await joinRoom(attacker, ROOM, RIGHT);
    assert.equal(right.code, 'RATE_LIMITED', 'over budget, the answer says nothing about the password');
    assert.equal(server.passwordChecks() - checksBefore, 5);
  });

  it('does not wake the room for a wrong password, or for none', async () => {
    const stranger = await open('203.0.113.11');
    assert.equal((await joinRoom(stranger, ROOM)).code, 'PASSWORD_REQUIRED');
    assert.equal((await joinRoom(stranger, ROOM.toUpperCase(), wrong(7))).code, 'PASSWORD_REQUIRED');

    assert.equal((await lobbyEntry(ROOM, 'private')).isActive, false, 'the room is still asleep');
    assert.equal(woken(ROOM), false);
  });

  it('lets the right password in from another network', async () => {
    const guest = await open('198.51.100.20');
    const checksBefore = server.passwordChecks();
    const reply = await joinRoom(guest, ROOM, RIGHT);
    assert.equal(reply.type, 'state');
    assert.equal(reply.payload.roomId, ROOM);
    assert.equal(server.passwordChecks() - checksBefore, 1);

    const entry = await lobbyEntry(ROOM, 'private');
    assert.equal(entry.isActive, true, 'with someone let in, the room runs');
    assert.equal(entry.listeners, 1);
    assert.equal(woken(ROOM), true);
  });

  it('lets the owner in without a password, even from a network over its budget', async () => {
    const owner = await open('203.0.113.10');
    const login = await request(owner, { type: 'RESUME_SESSION', payload: { token: OWNER_TOKEN } }, (m) => m.type === 'LOGIN_SUCCESS' || m.type === 'SESSION_INVALID');
    assert.equal(login.type, 'LOGIN_SUCCESS');
    const checksBefore = server.passwordChecks();
    const reply = await joinRoom(owner, ROOM);
    assert.equal(reply.type, 'state');
    assert.equal(server.passwordChecks() - checksBefore, 0);
  });

  it('counts all addresses of one IPv6 /64 as one network', async () => {
    for (let i = 1; i <= 5; i++) {
      const ws = await open(`2001:db8:5:6::${i}`);
      assert.equal((await joinRoom(ws, ROOM_V6, wrong(i))).code, 'PASSWORD_REQUIRED', `attempt ${i}`);
    }
    const sameNetwork = await open('2001:db8:5:6:ffff::99');
    assert.equal((await joinRoom(sameNetwork, ROOM_V6, wrong(6))).code, 'RATE_LIMITED');

    const nextNetwork = await open('2001:db8:5:7::1');
    assert.equal((await joinRoom(nextNetwork, ROOM_V6, RIGHT)).type, 'state');
  });

  it('runs bcrypt only five times for ten wrong passwords arriving at once', async () => {
    const crowd = await Promise.all(Array.from({ length: 10 }, () => open('203.0.113.30')));
    const checksBefore = server.passwordChecks();
    const replies = await Promise.all(crowd.map((ws, i) => joinRoom(ws, ROOM_BURST, wrong(i))));
    assert.deepEqual(codes(replies), { PASSWORD_REQUIRED: 5, RATE_LIMITED: 5 });
    assert.equal(server.passwordChecks() - checksBefore, 5);
  });

  it('drops a join the client moved on from while its password was being checked', async () => {
    const ws = await open('198.51.100.40');
    const received = [];
    ws.on('message', (data) => received.push(JSON.parse(data)));
    const done = server.bcryptCalls()['compare:done'];

    // Both in one write, so the server reads them together: the first is
    // still being checked when the second arrives.
    ws._socket.cork();
    ws.send(JSON.stringify({ type: 'JOIN_ROOM', payload: { roomId: ROOM_SLOW, password: RIGHT } }));
    const joined = joinRoom(ws, OPEN_ROOM);
    ws._socket.uncork();
    const reply = await joined;
    assert.equal(reply.type, 'state');
    assert.equal(reply.payload.roomId, OPEN_ROOM);

    await waitFor(() => server.bcryptCalls()['compare:done'] > done, { what: 'the first check to finish' });
    // Whatever that check caused has reached this socket before its PONG.
    await request(ws, { type: 'PING' }, (m) => m.type === 'PONG');

    assert.ok(!received.some((m) => m.type === 'state' && m.payload.roomId === ROOM_SLOW), 'no state from the room it left');
    assert.ok(!received.some((m) => m.type === 'error'), 'no answer to the dropped join');
    assert.equal((await lobbyEntry(ROOM_SLOW, 'private')).isActive, false, 'the room it left was not woken');
    assert.equal((await lobbyEntry(OPEN_ROOM, 'public')).listeners, 1);
  });

  it('creates a room whose password then works', async () => {
    const owner = await open('198.51.100.50');
    await request(owner, { type: 'RESUME_SESSION', payload: { token: OWNER_TOKEN } }, (m) => m.type === 'LOGIN_SUCCESS');
    const hashesBefore = server.bcryptCalls().hash;
    const created = await request(
      owner,
      { type: 'CREATE_ROOM', payload: { name: 'Fresh Party', isPrivate: true, password: 'fresh-pw-123' } },
      (m) => m.type === 'ROOM_CREATED' || m.type === 'error',
    );
    assert.equal(created.type, 'ROOM_CREATED');
    assert.ok(!('password' in created.payload), 'the hash stays on the server');
    assert.equal(server.bcryptCalls().hash - hashesBefore, 1, 'hashed once, asynchronously');
    assert.equal(server.bcryptCalls().hashSync, 0);

    const guest = await open('198.51.100.60');
    assert.equal((await joinRoom(guest, created.payload.id, 'not-it')).code, 'PASSWORD_REQUIRED');
    assert.equal((await joinRoom(guest, created.payload.id, 'fresh-pw-123')).type, 'state');
  });

  it('logs wrong passwords and refusals with room and network, never a password', async () => {
    const lines = server.logLines();
    const wrongs = lines.filter((line) => line.event === 'room_password_wrong');
    assert.ok(wrongs.some((line) => line.roomId === ROOM && line.netKey === '203.0.113.10'));
    assert.ok(wrongs.some((line) => line.roomId === ROOM_V6 && line.netKey === '2001:db8:5:6::/64'));
    assert.ok(wrongs.every((line) => line.level === 'warn'));

    const refusals = lines.filter((line) => line.event === 'room_password_limited');
    const mainRefusals = refusals.filter((line) => line.roomId === ROOM && line.netKey === '203.0.113.10');
    assert.equal(mainRefusals.length, 1, 'a run of refusals is logged once');
    assert.equal(mainRefusals[0].scope, 'net');

    const output = server.output();
    for (const secret of [RIGHT, 'fresh-pw-123', 'not-it', wrong(1), wrong(6)]) {
      assert.ok(!output.includes(secret), `"${secret}" is not in the log`);
    }
    assert.equal(server.bcryptCalls().compareSync, 0, 'no synchronous bcrypt left');
  });
});
