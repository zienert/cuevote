// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

let Room;
let db;

function mockWs(user = null) {
  const messages = [];
  return {
    id: 'mock-' + Math.random().toString(36).slice(2),
    readyState: 1,
    user,
    send(data) { messages.push(JSON.parse(data)); },
    close() { this.readyState = 3; },
    _messages: messages,
  };
}

describe('Room', () => {
  before(() => {
    process.env.NODE_ENV = 'test';
    const testDir = __dirname;
    const dbFile = path.join(testDir, 'cuevote.db');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(dbFile + suffix); } catch {}
    }
    process.chdir(testDir);
    delete require.cache[require.resolve('../db')];
    delete require.cache[require.resolve('../Room')];
    delete require.cache[require.resolve('../logger')];
    delete require.cache[require.resolve('../migrator')];
    db = require('../db');
    Room = require('../Room');

    db.upsertUser({
      id: 'owner-1',
      email: 'owner@example.com',
      name: 'Room Owner',
      picture: '',
    });
    db.upsertUser({
      id: 'guest-1',
      email: 'guest@example.com',
      name: 'Guest User',
      picture: '',
    });
  });

  after(() => {
    // Room writes through the async worker thread, which keeps the process
    // alive after the last assertion. Without this the runner hangs on a
    // finished suite instead of exiting.
    try { require('../db-async').shutdown(); } catch { /* never started */ }
    const dbFile = path.join(__dirname, 'cuevote.db');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(dbFile + suffix); } catch {}
    }
  });

  describe('Construction', () => {
    it('should create a room with default state', () => {
      const room = new Room('test-room', 'Test Room', null, { owner_id: 'owner-1' });
      assert.equal(room.id, 'test-room');
      assert.equal(room.name, 'Test Room');
      assert.equal(room.state.isPlaying, false);
      assert.deepEqual(room.state.queue, []);
      assert.equal(room.state.suggestionsEnabled, true);
      room.destroy();
    });

    it('should respect metadata settings', () => {
      const room = new Room('test-room-2', 'Room 2', null, {
        owner_id: 'owner-1',
        captions_enabled: 1,
        auto_refill: 0,
        language_flag: 'en',
      });
      assert.equal(room.state.captionsEnabled, true);
      assert.equal(room.state.autoRefill, false);
      assert.equal(room.metadata.language_flag, 'en');
      room.destroy();
    });

    it('should carry the room provider into state and summary', () => {
      const youtube = new Room('provider-yt', 'YT', null, { owner_id: 'owner-1' });
      assert.equal(youtube.state.provider, 'youtube');
      assert.equal(youtube.getSummary().provider, 'youtube');
      youtube.destroy();

      const apple = new Room('provider-am', 'AM', null, { owner_id: 'owner-1', provider: 'apple' });
      assert.equal(apple.state.provider, 'apple');
      assert.equal(apple.getSummary().provider, 'apple');
      apple.destroy();

      const unknown = new Room('provider-x', 'X', null, { owner_id: 'owner-1', provider: 'spotify' });
      assert.equal(unknown.state.provider, 'youtube');
      unknown.destroy();
    });

    it('should never show or store what an Apple room is playing in the lobby', () => {
      db.createRoom({
        id: 'provider-am-lobby', name: 'AM Lobby', description: '', owner_id: 'owner-1',
        color: 'red', is_public: 1, password: null, provider: 'apple',
      });
      const room = new Room('provider-am-lobby', 'AM Lobby', null, { owner_id: 'owner-1', provider: 'apple' });
      room.state.currentTrack = { videoId: 'am:video:1258705880', title: 'New Rules', artist: 'Dua Lipa', thumbnail: 'https://example.com/a.jpg' };
      assert.equal(room.getSummary().currentTrack, null);
      room.persistLobbyPreview();
      assert.equal(db.getRoom('provider-am-lobby').lobby_preview, null);
      room.destroy();
    });
  });

  describe('Client Management', () => {
    it('should add and remove clients', () => {
      const room = new Room('client-room', 'Client Room', null, { owner_id: 'owner-1' });
      const ws = mockWs({ id: 'guest-1', name: 'Guest' });

      room.addClient(ws);
      assert.equal(room.clients.size, 1);

      room.removeClient(ws);
      assert.equal(room.clients.size, 0);
      room.destroy();
    });

    it('should send full state on addClient', () => {
      const room = new Room('state-room', 'State Room', null, { owner_id: 'owner-1' });
      const ws = mockWs({ id: 'guest-1', name: 'Guest' });

      room.addClient(ws);
      assert.equal(ws._messages.length, 1);
      assert.equal(ws._messages[0].type, 'state');
      assert.ok(ws._messages[0].payload.roomId);
      room.removeClient(ws);
      room.destroy();
    });

    it('should reject connections to deleted rooms', () => {
      const room = new Room('deleted-room', 'Deleted', null, { owner_id: 'owner-1' });
      room.deleted = true;
      const ws = mockWs({ id: 'guest-1', name: 'Guest' });

      room.addClient(ws);
      assert.equal(room.clients.size, 0);
      assert.equal(ws._messages[0].type, 'error');
      room.destroy();
    });
  });

  describe('Voting', () => {
    it('should handle upvote on a queued track', () => {
      const room = new Room('vote-room', 'Vote Room', null, { owner_id: 'owner-1' });
      room.state.queue = [
        { id: 'track-1', videoId: 'v1', title: 'Track 1', score: 0, voters: {} },
        { id: 'track-2', videoId: 'v2', title: 'Track 2', score: 0, voters: {} },
      ];
      room.state.currentTrack = room.state.queue[0];

      const ws = mockWs({ id: 'guest-1', name: 'Guest' });
      room.addClient(ws);

      room.handleVote(ws, { trackId: 'track-2', voteType: 'up' });
      const track = room.state.queue.find(t => t.id === 'track-2');
      assert.equal(track.score, 1);
      assert.equal(track.voters['guest-1'], 'up');
      room.destroy();
    });

    it('should toggle vote off when same type is sent twice', () => {
      const room = new Room('toggle-room', 'Toggle Room', null, { owner_id: 'owner-1' });
      room.state.queue = [
        { id: 'track-1', videoId: 'v1', title: 'Track 1', score: 0, voters: {} },
        { id: 'track-2', videoId: 'v2', title: 'Track 2', score: 0, voters: {} },
      ];
      room.state.currentTrack = room.state.queue[0];

      const ws = mockWs({ id: 'guest-1', name: 'Guest' });
      room.addClient(ws);

      room.handleVote(ws, { trackId: 'track-2', voteType: 'up' });
      room.handleVote(ws, { trackId: 'track-2', voteType: 'up' });
      const track = room.state.queue.find(t => t.id === 'track-2');
      assert.equal(track.score, 0);
      assert.equal(track.voters['guest-1'], undefined);
      room.destroy();
    });

    it('should reject votes from unauthenticated users', () => {
      const room = new Room('auth-vote-room', 'Auth Vote', null, { owner_id: 'owner-1' });
      room.state.queue = [
        { id: 'track-1', videoId: 'v1', title: 'T1', score: 0, voters: {} },
      ];
      const ws = mockWs(null);
      room.addClient(ws);

      room.handleVote(ws, { trackId: 'track-1', voteType: 'up' });
      const lastMsg = ws._messages[ws._messages.length - 1];
      assert.equal(lastMsg.type, 'error');
      // No identity at all — distinct from a room that requires an account.
      assert.equal(lastMsg.code, 'NO_IDENTITY');
      assert.ok(!/signed-in account/i.test(lastMsg.message), lastMsg.message);
      room.destroy();
    });

    it('should sort queue by score after voting', () => {
      const room = new Room('sort-room', 'Sort Room', null, { owner_id: 'owner-1' });
      room.state.queue = [
        { id: 'current', videoId: 'v0', title: 'Current', score: 0, voters: {} },
        { id: 'track-a', videoId: 'v1', title: 'A', score: 0, voters: {} },
        { id: 'track-b', videoId: 'v2', title: 'B', score: 0, voters: {} },
      ];
      room.state.currentTrack = room.state.queue[0];

      const ws = mockWs({ id: 'guest-1', name: 'Guest' });
      room.addClient(ws);

      room.handleVote(ws, { trackId: 'track-b', voteType: 'up' });
      assert.equal(room.state.queue[0].id, 'current');
      assert.equal(room.state.queue[1].id, 'track-b');
      assert.equal(room.state.queue[2].id, 'track-a');
      room.destroy();
    });
  });

  describe('Owner Controls', () => {
    it('should allow owner to update settings', () => {
      const room = new Room('settings-room', 'Settings', null, { owner_id: 'owner-1' });
      const ws = mockWs({ id: 'owner-1', name: 'Owner' });
      room.addClient(ws);

      room.handleUpdateSettings({ musicOnly: true, maxDuration: 300 });
      assert.equal(room.state.musicOnly, true);
      assert.equal(room.state.maxDuration, 300);
      room.destroy();
    });

    it('should handle next track', () => {
      const room = new Room('next-room', 'Next', null, { owner_id: 'owner-1' });
      room.state.queue = [
        { id: 'current', videoId: 'v1', title: 'Current Track', score: 0, voters: {}, duration: 200, artist: 'A', thumbnail: 'x' },
        { id: 'next', videoId: 'v2', title: 'Next Track', score: 0, voters: {}, duration: 200, artist: 'B', thumbnail: 'y' },
      ];
      room.state.currentTrack = room.state.queue[0];
      room.state.isPlaying = true;

      room.handleNextTrack();
      assert.equal(room.state.currentTrack.id, 'next');
      assert.equal(room.state.queue.length, 1);
      assert.ok(room.state.history.length >= 1);
      room.destroy();
    });

    it('resumes a paused track where it stopped, however long the pause', async () => {
      const room = new Room('pause-room', 'Pause', null, { owner_id: 'owner-1' });
      const owner = mockWs({ id: 'owner-1', name: 'Owner' });
      room.addClient(owner);
      room.state.queue = [{ id: 'current', videoId: 'v1', title: 'Current', score: 0, voters: {}, duration: 210, artist: 'A', thumbnail: 'x' }];
      room.state.currentTrack = { ...room.state.queue[0], startedAt: Date.now() - 60000 };
      room.state.isPlaying = true;
      room.tick();
      assert.equal(room.state.progress, 60);

      await room.handleMessage(owner, { type: 'PLAY_PAUSE', payload: false });
      assert.equal(room.state.progress, 60, 'the pause freezes the position');

      // Ten minutes later, longer than the track.
      room.state.currentTrack.startedAt -= 600000;
      await room.handleMessage(owner, { type: 'PLAY_PAUSE', payload: true });
      room.tick();
      assert.equal(room.state.currentTrack.id, 'current', 'not skipped');
      assert.ok(room.state.progress >= 60 && room.state.progress <= 61, `goes on at 60 s, got ${room.state.progress}`);
      room.destroy();
    });
  });

  describe('Playback Error Handling', () => {
    const seedQueue = (room) => {
      room.state.queue = [
        { id: 'a', videoId: 'vidA', title: 'A', score: 0, voters: {}, duration: 200, artist: 'A', thumbnail: 'x' },
        { id: 'b', videoId: 'vidB', title: 'B', score: 0, voters: {}, duration: 200, artist: 'B', thumbnail: 'y' },
        { id: 'c', videoId: 'vidC', title: 'C', score: 0, voters: {}, duration: 200, artist: 'C', thumbnail: 'z' },
      ];
      room.state.currentTrack = room.state.queue[0];
      room.state.isPlaying = true;
    };
    // YouTube API shape for a deleted/private video: no items returned
    const goneResponse = { ok: true, json: async () => ({ items: [] }) };

    it('should not double-skip on concurrent PLAYBACK_ERRORs for the same video', async () => {
      const room = new Room('pberr-dupe', 'PB Dupe', 'test-key', { owner_id: 'owner-1' });
      seedQueue(room);
      const originalFetch = global.fetch;
      const resolvers = [];
      global.fetch = () => new Promise((resolve) => resolvers.push(resolve));
      try {
        const ws = mockWs({ id: 'owner-1' });
        const p1 = room.handlePlaybackError(ws, { videoId: 'vidA', errorCode: 100 });
        const p2 = room.handlePlaybackError(ws, { videoId: 'vidA', errorCode: 100 });
        assert.equal(resolvers.length, 1, 'second concurrent check should be deduped');
        resolvers.forEach((resolve) => resolve(goneResponse));
        await Promise.all([p1, p2]);
        assert.equal(room.state.currentTrack.videoId, 'vidB');
        assert.equal(room.state.queue.length, 2);
      } finally {
        global.fetch = originalFetch;
        room.destroy();
      }
    });

    it('should not skip the successor when the queue advanced during the API check', async () => {
      const room = new Room('pberr-advance', 'PB Advance', 'test-key', { owner_id: 'owner-1' });
      seedQueue(room);
      const originalFetch = global.fetch;
      let resolveFetch;
      global.fetch = () => new Promise((resolve) => { resolveFetch = resolve; });
      try {
        const ws = mockWs({ id: 'owner-1' });
        const pending = room.handlePlaybackError(ws, { videoId: 'vidA', errorCode: 100 });
        room.handleNextTrack(); // tick()-style auto-advance while the check is in flight
        assert.equal(room.state.currentTrack.videoId, 'vidB');
        resolveFetch(goneResponse);
        await pending;
        assert.equal(room.state.currentTrack.videoId, 'vidB', 'stale error must not skip the successor track');
        assert.equal(room.state.queue.length, 2);
      } finally {
        global.fetch = originalFetch;
        room.destroy();
      }
    });
  });

  describe('Broadcast', () => {
    it('should broadcast delta state on updateState', () => {
      const room = new Room('broadcast-room', 'Broadcast', null, { owner_id: 'owner-1' });
      const ws = mockWs({ id: 'guest-1', name: 'Guest' });
      room.addClient(ws);
      ws._messages.length = 0;

      room.updateState({ votesEnabled: false });
      assert.equal(ws._messages.length, 1);
      assert.equal(ws._messages[0].type, 'state_delta');
      assert.equal(ws._messages[0].payload.votesEnabled, false);
      room.destroy();
    });

    it('should not send to closed connections', () => {
      const room = new Room('closed-room', 'Closed', null, { owner_id: 'owner-1' });
      const ws = mockWs({ id: 'guest-1', name: 'Guest' });
      room.addClient(ws);
      ws.readyState = 3;
      ws._messages.length = 0;

      room.updateState({ musicOnly: true });
      assert.equal(ws._messages.length, 0);
      room.destroy();
    });
  });

  describe('Guest access', () => {
    const guestWs = () => mockWs({ id: 'guest:abc123', name: 'Guest 4F2A', guestTag: '4F2A', isGuest: true });

    it('lets a guest vote when the room does not require a login', () => {
      const room = new Room('guest-open', 'Open Room', null, { owner_id: 'owner-1' });
      room.state.queue = [
        { id: 'current', videoId: 'v0', title: 'Current', score: 0, voters: {} },
        { id: 'track-1', videoId: 'v1', title: 'T1', score: 0, voters: {} },
      ];
      const ws = guestWs();
      room.addClient(ws);

      room.handleVote(ws, { trackId: 'track-1', voteType: 'up' });

      const track = room.state.queue.find(t => t.id === 'track-1');
      assert.equal(track.score, 1);
      assert.equal(track.voters['guest:abc123'], 'up');
      room.destroy();
    });

    it('defaults requireLogin to off', () => {
      const room = new Room('guest-default', 'Default Room', null, { owner_id: 'owner-1' });
      assert.equal(room.state.requireLogin, false);
      room.destroy();
    });

    it('honours require_login from the room metadata', () => {
      const room = new Room('guest-meta', 'Meta Room', null, { owner_id: 'owner-1', require_login: 1 });
      assert.equal(room.state.requireLogin, true);
      room.destroy();
    });

    it('rejects a guest vote when the room requires a login', () => {
      const room = new Room('guest-closed', 'Closed Room', null, { owner_id: 'owner-1', require_login: 1 });
      room.state.queue = [
        { id: 'current', videoId: 'v0', title: 'Current', score: 0, voters: {} },
        { id: 'track-1', videoId: 'v1', title: 'T1', score: 0, voters: {} },
      ];
      const ws = guestWs();
      room.addClient(ws);

      room.handleVote(ws, { trackId: 'track-1', voteType: 'up' });

      const lastMsg = ws._messages[ws._messages.length - 1];
      assert.equal(lastMsg.type, 'error');
      assert.equal(lastMsg.code, 'LOGIN_REQUIRED');
      const track = room.state.queue.find(t => t.id === 'track-1');
      assert.equal(track.score, 0);
      assert.deepEqual(track.voters, {});
      room.destroy();
    });

    it('still lets a signed-in user vote when the room requires a login', () => {
      const room = new Room('guest-closed-user', 'Closed Room', null, { owner_id: 'owner-1', require_login: 1 });
      room.state.queue = [
        { id: 'current', videoId: 'v0', title: 'Current', score: 0, voters: {} },
        { id: 'track-1', videoId: 'v1', title: 'T1', score: 0, voters: {} },
      ];
      const ws = mockWs({ id: 'guest-1', name: 'Guest User' });
      room.addClient(ws);

      room.handleVote(ws, { trackId: 'track-1', voteType: 'up' });

      assert.equal(room.state.queue.find(t => t.id === 'track-1').score, 1);
      room.destroy();
    });

    it('rejects a guest suggestion when the room requires a login', async () => {
      const room = new Room('guest-suggest', 'Suggest Room', null, { owner_id: 'owner-1', require_login: 1 });
      const ws = guestWs();
      room.addClient(ws);

      await room.handleSuggestSong(ws, { query: 'anything' });

      const lastMsg = ws._messages[ws._messages.length - 1];
      assert.equal(lastMsg.type, 'error');
      assert.equal(lastMsg.code, 'LOGIN_REQUIRED');
      room.destroy();
    });

    it('persists the owner toggle so a restart keeps the rule', () => {
      db.createRoom({
        id: 'guest-persist',
        name: 'Persist Room',
        description: '',
        owner_id: 'owner-1',
        color: 'from-gray-700 to-black',
        is_public: 1,
        password: null,
      });

      const room = new Room('guest-persist', 'Persist Room', null, { owner_id: 'owner-1' });
      room.handleUpdateSettings({ requireLogin: true });
      assert.equal(room.state.requireLogin, true);
      room.destroy();

      assert.equal(db.getRoom('guest-persist').require_login, 1);

      // A room rebuilt from the stored row keeps the rule.
      const reopened = new Room('guest-persist', 'Persist Room', null, db.getRoom('guest-persist'));
      assert.equal(reopened.state.requireLogin, true);
      reopened.destroy();
    });

    it('refuses a socket with no identity for a different reason than a login-only room', () => {
      const open = new Room('guest-noid-open', 'Open', null, { owner_id: 'owner-1' });
      const closed = new Room('guest-noid-closed', 'Closed', null, { owner_id: 'owner-1', require_login: 1 });

      const noIdentity = open.canParticipate(mockWs(null));
      assert.equal(noIdentity.ok, false);
      assert.equal(noIdentity.code, 'NO_IDENTITY');
      // The room does not require an account, so the refusal must not say it does.
      assert.ok(!/signed-in account/i.test(noIdentity.message), noIdentity.message);

      const needsAccount = closed.canParticipate(guestWs());
      assert.equal(needsAccount.code, 'LOGIN_REQUIRED');
      assert.match(needsAccount.message, /signed-in account/i);

      open.destroy();
      closed.destroy();
    });

    it('carries a guest\'s vote onto the account when they sign in', () => {
      const room = new Room('merge-room', 'Merge', null, { owner_id: 'owner-1' });
      room.state.queue = [
        { id: 'current', videoId: 'v0', title: 'Current', score: 0, voters: {} },
        { id: 'track-1', videoId: 'v1', title: 'T1', score: 0, voters: {} },
      ];
      const ws = guestWs();
      room.addClient(ws);
      room.handleVote(ws, { trackId: 'track-1', voteType: 'up' });
      assert.equal(room.state.queue.find(t => t.id === 'track-1').score, 1);

      room.mergeIdentity('guest:abc123', 'guest-1');

      const track = room.state.queue.find(t => t.id === 'track-1');
      assert.equal(track.score, 1, 'the vote is kept, not doubled or lost');
      assert.equal(track.voters['guest-1'], 'up', 'it now belongs to the account');
      assert.equal(track.voters['guest:abc123'], undefined, 'the guest key is gone');
      room.destroy();
    });

    it('does not let one person count twice when both identities voted', () => {
      const room = new Room('merge-dupe', 'Merge Dupe', null, { owner_id: 'owner-1' });
      room.state.queue = [
        { id: 'current', videoId: 'v0', title: 'Current', score: 0, voters: {} },
        { id: 'track-1', videoId: 'v1', title: 'T1', score: 2, voters: { 'guest:abc123': 'up', 'guest-1': 'up' } },
      ];

      room.mergeIdentity('guest:abc123', 'guest-1');

      const track = room.state.queue.find(t => t.id === 'track-1');
      assert.equal(track.score, 1, 'the duplicate is taken back out of the score');
      assert.equal(track.voters['guest-1'], 'up');
      assert.equal(track.voters['guest:abc123'], undefined);
      room.destroy();
    });

    it('re-attributes a suggestion and drops the guest marker', () => {
      const room = new Room('merge-attr', 'Merge Attr', null, { owner_id: 'owner-1' });
      room.state.queue = [
        { id: 'current', videoId: 'v0', title: 'Current', score: 0, voters: {} },
        {
          id: 'track-1', videoId: 'v1', title: 'T1', score: 0, voters: {},
          suggestedBy: 'guest:abc123', suggestedByIsGuest: true, suggestedByGuestTag: '4F2A',
        },
      ];

      room.mergeIdentity('guest:abc123', 'guest-1');

      const track = room.state.queue.find(t => t.id === 'track-1');
      assert.equal(track.suggestedBy, 'guest-1');
      assert.equal(track.suggestedByIsGuest, false);
      assert.equal('suggestedByGuestTag' in track, false);
      room.destroy();
    });

    it('shows the account name on a suggestion made as a guest', () => {
      const room = new Room('merge-name', 'Merge Name', null, { owner_id: 'owner-1' });
      room.state.queue = [
        { id: 'current', videoId: 'v0', title: 'Current', score: 0, voters: {} },
        {
          id: 'track-1', videoId: 'v1', title: 'T1', score: 0, voters: {},
          suggestedBy: 'guest:abc123', suggestedByUsername: 'Guest 4F2A',
          suggestedByIsGuest: true, suggestedByGuestTag: '4F2A',
        },
        {
          id: 'track-2', videoId: 'v2', title: 'T2', score: 0, voters: {},
          suggestedBy: 'owner-1', suggestedByUsername: 'Room Owner',
        },
      ];

      room.mergeIdentity('guest:abc123', 'guest-1', 'Second User');

      const mine = room.state.queue.find(t => t.id === 'track-1');
      assert.equal(mine.suggestedByUsername, 'Second User', 'not the English "Guest 4F2A" any more');
      const theirs = room.state.queue.find(t => t.id === 'track-2');
      assert.equal(theirs.suggestedByUsername, 'Room Owner', 'other people\'s suggestions keep their names');
      room.destroy();
    });

    it('leaves a room alone when the identity never took part', () => {
      const room = new Room('merge-noop', 'Merge Noop', null, { owner_id: 'owner-1' });
      const queue = [{ id: 'current', videoId: 'v0', title: 'Current', score: 0, voters: {} }];
      room.state.queue = queue;
      assert.equal(room.mergeIdentity('guest:nobody', 'guest-1'), false);
      assert.equal(room.state.queue, queue, 'no needless re-allocation or broadcast');
      room.destroy();
    });

    it('requires an account to spend Search quota, even for a guest', async () => {
      const room = new Room('quota-room', 'Quota', null, { owner_id: 'owner-1' });
      const ws = guestWs();
      room.addClient(ws);

      await room.handleFetchSuggestions(ws, { videoId: 'dQw4w9WgXcQ' });

      const lastMsg = ws._messages[ws._messages.length - 1];
      assert.equal(lastMsg.type, 'error');
      assert.equal(lastMsg.code, 'ACCOUNT_REQUIRED');
      room.destroy();
    });

    it('never sends a guest id to other clients', () => {
      const room = new Room('guest-projection', 'Projection Room', null, { owner_id: 'owner-1' });
      room.state.queue = [
        {
          id: 'track-1', videoId: 'v1', title: 'T1', score: 1,
          voters: { 'guest:abc123': 'up' },
          suggestedBy: 'guest:abc123',
          suggestedByUsername: 'Guest 4F2A',
          suggestedByIsGuest: true,
          suggestedByGuestTag: '4F2A',
        },
      ];
      const observer = mockWs({ id: 'owner-1', name: 'Room Owner' });
      room.addClient(observer);
      room.sendStateTo(observer);

      const stateMsg = observer._messages.filter(m => m.type === 'state').pop();
      const sent = stateMsg.payload.queue[0];
      assert.equal(sent.voters, undefined);
      assert.equal(sent.suggestedBy, undefined);
      assert.equal(sent.suggestedByIsGuest, true);
      assert.equal(sent.suggestedByGuestTag, '4F2A');
      assert.ok(!JSON.stringify(stateMsg).includes('guest:abc123'));
      room.destroy();
    });
  });

  describe('State projection (PII)', () => {
    function roomWithVotes(id) {
      const room = new Room(id, id, null, { owner_id: 'owner-1' });
      room.state.queue = [
        {
          id: 'track-1', videoId: 'v1', title: 'Track 1', score: 1,
          voters: { 'guest-1': 'up', 'guest-2': 'down' },
          suggestedBy: 'guest-2', suggestedByUsername: 'Guest Two',
        },
      ];
      room.state.currentTrack = room.state.queue[0];
      room.state.history = [{ id: 'old', videoId: 'v0', voters: { 'guest-1': 'up' }, suggestedBy: 'guest-1' }];
      room.state.pendingSuggestions = [{ id: 'p1', videoId: 'v9', voters: {}, suggestedBy: 'guest-2', suggestedByUsername: 'Guest Two' }];
      return room;
    }

    // The voters map is keyed by Google account id — it must not reach any
    // client, and JOIN_ROOM does not even require a login.
    it('never sends voters or suggestedBy to a client', () => {
      const room = roomWithVotes('project-room');
      const ws = mockWs(null);
      room.addClient(ws);

      const state = ws._messages[0].payload;
      for (const track of [state.currentTrack, ...state.queue, ...state.history, ...state.pendingSuggestions]) {
        assert.equal(track.voters, undefined);
        assert.equal(track.suggestedBy, undefined);
      }
      room.removeClient(ws);
      room.destroy();
    });

    it('keeps the display name, which is meant to be visible', () => {
      const room = roomWithVotes('project-name-room');
      const ws = mockWs(null);
      room.addClient(ws);

      assert.equal(ws._messages[0].payload.queue[0].suggestedByUsername, 'Guest Two');
      room.removeClient(ws);
      room.destroy();
    });

    it('gives each viewer its own vote and nobody else\'s', () => {
      const room = roomWithVotes('project-myvote-room');
      const up = mockWs({ id: 'guest-1', name: 'One' });
      const down = mockWs({ id: 'guest-2', name: 'Two' });
      const guest = mockWs(null);
      room.addClient(up);
      room.addClient(down);
      room.addClient(guest);

      assert.equal(up._messages[0].payload.queue[0].myVote, 'up');
      assert.equal(down._messages[0].payload.queue[0].myVote, 'down');
      assert.equal(guest._messages[0].payload.queue[0].myVote, undefined);
      room.destroy();
    });

    it('projects deltas per viewer too', () => {
      const room = roomWithVotes('project-delta-room');
      const up = mockWs({ id: 'guest-1', name: 'One' });
      const guest = mockWs(null);
      room.addClient(up);
      room.addClient(guest);
      up._messages.length = 0;
      guest._messages.length = 0;

      room.updateState({ queue: room.state.queue });

      assert.equal(up._messages[0].payload.queue[0].myVote, 'up');
      assert.equal(up._messages[0].payload.queue[0].voters, undefined);
      assert.equal(guest._messages[0].payload.queue[0].myVote, undefined);
      assert.equal(guest._messages[0].payload.queue[0].voters, undefined);
      room.destroy();
    });

    it('leaves the server-side state untouched so voting still works', () => {
      const room = roomWithVotes('project-server-state-room');
      const ws = mockWs({ id: 'guest-1', name: 'One' });
      room.addClient(ws);

      assert.equal(room.state.queue[0].voters['guest-1'], 'up');
      room.handleVote(ws, { trackId: 'track-1', voteType: 'up' }); // toggles off
      assert.equal(room.state.queue[0].voters['guest-1'], undefined);
      room.destroy();
    });

    it('re-projects for one socket when its identity changes', () => {
      const room = roomWithVotes('project-resend-room');
      const ws = mockWs(null);
      room.addClient(ws);
      assert.equal(ws._messages[0].payload.queue[0].myVote, undefined);

      ws.user = { id: 'guest-1', name: 'One' }; // as LOGIN / RESUME_SESSION does
      ws._messages.length = 0;
      room.sendStateTo(ws);

      assert.equal(ws._messages[0].type, 'state');
      assert.equal(ws._messages[0].payload.queue[0].myVote, 'up');
      room.destroy();
    });
  });

  describe('Metadata Rehydration', () => {
    it('fills cleared title/artist on the now-playing track + queue and broadcasts', async () => {
      const room = new Room('rehydrate-room', 'Rehydrate', null, { owner_id: 'owner-1' });

      // Simulate state restored from a dormant room: valid video IDs, but title/
      // artist cleared by the 28-day cleanup. currentTrack mirrors queue[0] by id.
      room.state.currentTrack = { id: 'c1', videoId: 'VID_CUR', title: null, artist: null, score: 0, voters: {} };
      room.state.queue = [
        { id: 'c1', videoId: 'VID_CUR', title: null, artist: null, score: 0, voters: {} },
        { id: 'q2', videoId: 'VID_Q2', title: null, artist: null, score: 5, voters: { u1: 'up' } },
        { id: 'q3', videoId: 'VID_Q3', title: 'Already Titled', artist: 'Known', score: 0, voters: {} },
      ];

      // Stub the YouTube layer so the test needs no API key / network.
      const requested = [];
      room.checkVideoAvailability = async (ids) => {
        requested.push(...ids);
        return new Map(ids.map(id => [id, {
          title: 'Title ' + id, artist: 'Artist ' + id, thumbnail: 'http://thumb/' + id, duration: 123,
        }]));
      };

      const ws = mockWs({ id: 'guest-1', name: 'Guest' });
      room.clients.add(ws);

      await room.rehydrateVisibleMetadata();

      // Only the cleared tracks were fetched (already-titled q3 skipped; VID_CUR deduped).
      assert.deepEqual(requested.sort(), ['VID_CUR', 'VID_Q2']);

      // Title/artist filled in on now-playing + queue.
      assert.equal(room.state.currentTrack.title, 'Title VID_CUR');
      assert.equal(room.state.currentTrack.artist, 'Artist VID_CUR');
      assert.equal(room.state.queue[0].title, 'Title VID_CUR');
      assert.equal(room.state.queue[1].title, 'Title VID_Q2');

      // App data preserved.
      assert.equal(room.state.queue[1].score, 5);
      assert.deepEqual(room.state.queue[1].voters, { u1: 'up' });
      assert.equal(room.state.queue[1].videoId, 'VID_Q2');

      // Already-titled track untouched.
      assert.equal(room.state.queue[2].title, 'Already Titled');

      // A state_delta carrying the refreshed queue was broadcast to the client.
      const delta = ws._messages.find(m => m.type === 'state_delta' && m.payload && m.payload.queue);
      assert.ok(delta, 'expected a state_delta broadcast with the refreshed queue');
      assert.equal(delta.payload.queue[1].title, 'Title VID_Q2');

      room.destroy();
    });

    it('does not hit the API when no visible title is missing', async () => {
      const room = new Room('rehydrate-noop', 'NoOp', null, { owner_id: 'owner-1' });
      room.state.currentTrack = { id: 'c1', videoId: 'V1', title: 'Has Title', artist: 'A', score: 0, voters: {} };
      room.state.queue = [{ id: 'c1', videoId: 'V1', title: 'Has Title', artist: 'A', score: 0, voters: {} }];

      let called = false;
      room.checkVideoAvailability = async () => { called = true; return new Map(); };

      await room.rehydrateVisibleMetadata();
      assert.equal(called, false, 'should skip the API when nothing is missing');
      room.destroy();
    });

    it('drops an upcoming track the API confirmed is gone (id absent from the result)', async () => {
      const room = new Room('rehydrate-drop', 'Drop', null, { owner_id: 'owner-1' });

      // currentTrack already has a title, so only the two title-less queue items get queried.
      room.state.currentTrack = { id: 'c1', videoId: 'VID_CUR', title: 'Now Playing', artist: 'A', score: 0, voters: {} };
      room.state.queue = [
        { id: 'c1', videoId: 'VID_CUR', title: 'Now Playing', artist: 'A', score: 0, voters: {} },
        { id: 'q2', videoId: 'VID_GONE', title: null, artist: null, score: 0, voters: {} },     // deleted/private → absent
        { id: 'q3', videoId: 'VID_OK', title: null, artist: null, score: 2, voters: { u1: 'up' } }, // resolvable
      ];

      // Successful call: VID_OK resolves, VID_GONE is OMITTED (mirrors a deleted/private/
      // non-embeddable video, which checkVideoAvailability leaves out of the Map).
      const requested = [];
      room.checkVideoAvailability = async (ids) => {
        requested.push(...ids);
        const map = new Map();
        for (const id of ids) {
          if (id === 'VID_OK') map.set(id, { title: 'OK Title', artist: 'OK Artist', thumbnail: 'http://thumb/ok', duration: 100 });
          // VID_GONE intentionally omitted → absent → confirmed unavailable
        }
        return map;
      };

      const ws = mockWs({ id: 'guest-1', name: 'Guest' });
      room.clients.add(ws);

      await room.rehydrateVisibleMetadata();

      assert.deepEqual(requested.sort(), ['VID_GONE', 'VID_OK']);
      // Confirmed-gone track removed; current + resolvable track kept, in order.
      assert.deepEqual(room.state.queue.map(t => t.videoId), ['VID_CUR', 'VID_OK']);
      assert.equal(room.state.queue[1].title, 'OK Title', 'survivor got healed');
      assert.equal(room.state.queue[1].score, 2, 'app data preserved on survivor');
      // Now-playing untouched.
      assert.equal(room.state.currentTrack.videoId, 'VID_CUR');
      assert.equal(room.state.currentTrack.title, 'Now Playing');

      // The shortened queue was broadcast.
      const delta = ws._messages.find(m => m.type === 'state_delta' && m.payload && m.payload.queue);
      assert.ok(delta, 'expected a state_delta with the cleaned queue');
      assert.equal(delta.payload.queue.length, 2);

      room.destroy();
    });

    it('keeps a track the API could not verify (present-but-null: no key / quota / error)', async () => {
      const room = new Room('rehydrate-keep', 'Keep', null, { owner_id: 'owner-1' });
      room.state.currentTrack = { id: 'c1', videoId: 'VID_CUR', title: 'Now', artist: 'A', score: 0, voters: {} };
      room.state.queue = [
        { id: 'c1', videoId: 'VID_CUR', title: 'Now', artist: 'A', score: 0, voters: {} },
        { id: 'q2', videoId: 'VID_UNVERIFIED', title: null, artist: null, score: 3, voters: { u1: 'up' } },
      ];

      // "Couldn't verify": every id comes back present-with-null, exactly as
      // checkVideoAvailability does with no API key or on an HTTP/fetch error.
      room.checkVideoAvailability = async (ids) => new Map(ids.map(id => [id, null]));

      const ws = mockWs({ id: 'guest-1', name: 'Guest' });
      room.clients.add(ws);

      await room.rehydrateVisibleMetadata();

      // Unverifiable track is retained as a skeleton (retriable later), not dropped.
      assert.equal(room.state.queue.length, 2);
      assert.equal(room.state.queue[1].videoId, 'VID_UNVERIFIED');
      assert.equal(room.state.queue[1].title, null);
      assert.equal(room.state.queue[1].score, 3, 'app data preserved');

      room.destroy();
    });

    it('never drops the now-playing track even when the API reports it gone', async () => {
      const room = new Room('rehydrate-current-gone', 'CurGone', null, { owner_id: 'owner-1' });
      // currentTrack itself is a cleared skeleton AND will come back absent.
      room.state.currentTrack = { id: 'c1', videoId: 'VID_GONE', title: null, artist: null, score: 0, voters: {} };
      room.state.queue = [
        { id: 'c1', videoId: 'VID_GONE', title: null, artist: null, score: 0, voters: {} },
        { id: 'q2', videoId: 'VID_OK', title: null, artist: null, score: 0, voters: {} },
      ];

      room.checkVideoAvailability = async (ids) => {
        const map = new Map();
        for (const id of ids) {
          if (id === 'VID_OK') map.set(id, { title: 'OK', artist: 'A', thumbnail: 'http://thumb/ok', duration: 50 });
          // VID_GONE omitted → absent
        }
        return map;
      };

      const ws = mockWs({ id: 'guest-1', name: 'Guest' });
      room.clients.add(ws);

      await room.rehydrateVisibleMetadata();

      // queue[0] mirrors currentTrack, so it is preserved despite being confirmed gone —
      // tick()/skip logic relies on queue[0] === current. It stays a skeleton; the playing
      // copy is resolved through PLAYBACK_ERROR, not yanked mid-rehydrate.
      assert.equal(room.state.queue.length, 2, 'current mirror retained, rest healed');
      assert.equal(room.state.queue[0].videoId, 'VID_GONE');
      assert.equal(room.state.currentTrack.videoId, 'VID_GONE');
      assert.equal(room.state.queue[1].title, 'OK');

      room.destroy();
    });
  });

  describe('Apple Music rooms', () => {
    const video = (id, title, duration = 221) => ({
      videoId: `am:video:${id}`, provider: 'apple', kind: 'musicVideo', title,
      artist: 'Dua Lipa', thumbnail: 'https://example.com/a.jpg', duration, explicit: false,
    });
    const song = (id, title) => ({ ...video(id, title), videoId: `am:song:${id}`, kind: 'song' });

    let calls = [];
    function useCatalog({ search = { videos: [], songs: [] }, items = [], fail = false, equivalents = {} } = {}) {
      calls = [];
      const outage = () => Object.assign(new Error('down'), { code: 'APPLE_CATALOG_UNREACHABLE' });
      Room.setAppleCatalog({
        async search(storefront, term) {
          calls.push(['search', storefront, term]);
          if (fail) throw outage();
          return search;
        },
        async lookup(storefront, keys) {
          calls.push(['lookup', storefront, keys]);
          if (fail) throw outage();
          return new Map(items.filter(t => keys.includes(t.videoId)).map(t => [t.videoId, t]));
        },
        // equivalents: { 'am:song:US-id': track in this storefront }
        async equivalents(storefront, keys) {
          calls.push(['equivalents', storefront, keys]);
          if (fail) throw outage();
          return new Map(keys.filter(k => equivalents[k]).map(k => [k, equivalents[k]]));
        },
      });
    }

    let roomCounter = 0;
    function appleRoom(storefront = 'nl') {
      const id = `apple-room-${++roomCounter}`;
      db.createRoom({ id, name: id, description: '', owner_id: 'owner-1', color: 'red', is_public: 1, password: null, provider: 'apple' });
      return new Room(id, id, null, { owner_id: 'owner-1', provider: 'apple', apple_storefront: storefront });
    }
    const ownerWs = () => mockWs({ id: 'owner-1', name: 'Owner' });
    const guestWs = () => mockWs({ id: 'guest-1', name: 'Guest' });
    const lastOf = (ws, type) => ws._messages.filter(m => m.type === type).pop();
    const suggest = (room, ws, query) => room.handleMessage(ws, { type: 'SUGGEST_SONG', payload: { query } });

    after(() => Room.setAppleCatalog(null));

    it('needs the catalog and the host storefront before taking suggestions', async () => {
      Room.setAppleCatalog(null);
      const room = appleRoom();
      let ws = guestWs();
      await suggest(room, ws, 'new rules');
      assert.equal(lastOf(ws, 'error').code, 'APPLE_MUSIC_UNAVAILABLE');

      useCatalog();
      const unconnected = appleRoom(null);
      ws = guestWs();
      await suggest(unconnected, ws, 'new rules');
      assert.equal(lastOf(ws, 'error').code, 'APPLE_MUSIC_NOT_CONNECTED');
      assert.equal(calls.length, 0);
      room.destroy();
      unconnected.destroy();
    });

    it('stores the storefront only the host reports', async () => {
      const room = appleRoom(null);
      await room.handleMessage(guestWs(), { type: 'APPLE_STOREFRONT', payload: 'us' });
      assert.equal(room.metadata.apple_storefront, null);
      await room.handleMessage(ownerWs(), { type: 'APPLE_STOREFRONT', payload: 'DEU' });
      assert.equal(room.metadata.apple_storefront, null);
      await room.handleMessage(ownerWs(), { type: 'APPLE_STOREFRONT', payload: 'de' });
      assert.equal(room.metadata.apple_storefront, 'de');
      assert.equal(db.getRoom(room.id).apple_storefront, 'de');
      room.destroy();
    });

    it('queues the first music video of a search before any song', async () => {
      useCatalog({ search: { videos: [video(1258705880, 'New Rules')], songs: [song(1228739609, 'New Rules')] } });
      const room = appleRoom();
      const ws = guestWs();
      await suggest(room, ws, 'new rules');
      assert.deepEqual(calls[0], ['search', 'nl', 'new rules']);
      assert.equal(lastOf(ws, 'success').message, 'Added');
      assert.equal(room.state.currentTrack.videoId, 'am:video:1258705880');
      assert.equal(room.state.queue[0].suggestedBy, 'guest-1');
      room.destroy();
    });

    it('queues the original music video when Apple ranks a remix first', async () => {
      useCatalog({ search: { videos: [video(1, 'Levitating (The Blessed Madonna Remix)'), video(2, 'Levitating')], songs: [] } });
      const room = appleRoom();
      await suggest(room, guestWs(), 'dua lipa levitating');
      assert.equal(room.state.currentTrack.videoId, 'am:video:2');
      room.destroy();
    });

    it('falls back to a song when there is no music video', async () => {
      useCatalog({ search: { videos: [], songs: [song(1538003843, 'Levitating')] } });
      const room = appleRoom();
      await suggest(room, guestWs(), 'levitating');
      assert.equal(room.state.currentTrack.videoId, 'am:song:1538003843');
      room.destroy();
    });

    it('looks music.apple.com links up in the host storefront', async () => {
      useCatalog({ items: [video(1258705880, 'New Rules')] });
      const room = appleRoom('de');
      await suggest(room, guestWs(), 'https://music.apple.com/us/music-video/new-rules/1258705880');
      assert.deepEqual(calls[0], ['lookup', 'de', ['am:video:1258705880']]);
      assert.equal(room.state.currentTrack.videoId, 'am:video:1258705880');

      const ws = guestWs();
      await suggest(room, ws, 'https://music.apple.com/us/music-video/gone/999');
      assert.equal(lastOf(ws, 'error').code, 'APPLE_MUSIC_NOT_IN_STOREFRONT');
      room.destroy();
    });

    it('refuses YouTube links without asking any catalog', async () => {
      useCatalog();
      const room = appleRoom();
      const ws = guestWs();
      await suggest(room, ws, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      assert.equal(lastOf(ws, 'error').code, 'APPLE_MUSIC_ROOM');
      assert.equal(calls.length, 0);
      assert.equal(room.state.queue.length, 0);
      room.destroy();
    });

    it('applies bans and the maximum duration', async () => {
      useCatalog({ search: { videos: [video(1, 'Long One', 900)], songs: [] }, items: [video(2, 'Banned')] });
      const room = appleRoom();
      room.state.bannedVideos = [{ videoId: 'am:video:2', title: 'Banned' }];

      let ws = guestWs();
      await suggest(room, ws, 'https://music.apple.com/nl/music-video/banned/2');
      assert.match(lastOf(ws, 'error').message, /banned/);
      assert.equal(calls.length, 0, 'a banned link needs no lookup');

      ws = guestWs();
      await suggest(room, ws, 'long one');
      assert.match(lastOf(ws, 'error').message, /too long/);
      assert.equal(room.state.queue.length, 0);
      room.destroy();
    });

    it('refuses links it cannot play instead of searching them as text', async () => {
      useCatalog({ search: { videos: [video(9, 'Open Your Eyes')], songs: [] } });
      const room = appleRoom();
      const ws = guestWs();
      await suggest(room, ws, 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
      assert.equal(lastOf(ws, 'error').code, 'APPLE_MUSIC_ROOM');
      const another = guestWs(); // past the per-socket wait between suggestions
      await suggest(room, another, 'https://music.apple.com/nl/album/future-nostalgia/1538003494');
      assert.equal(lastOf(another, 'error').code, 'APPLE_MUSIC_LINK_UNSUPPORTED');
      assert.equal(room.state.queue.length, 0);
      assert.equal(calls.some(c => c[0] === 'search'), false, 'no text search');
      room.destroy();
    });

    it('takes a link from another country as the same recording in the host country', async () => {
      const dutch = { ...song(1715687117, 'Sexy Bitch (feat. Akon)'), artist: 'David Guetta' };
      useCatalog({ equivalents: { 'am:song:693246512': dutch } });
      const room = appleRoom('nl');
      const ws = guestWs();
      await suggest(room, ws, 'https://music.apple.com/us/song/sexy-bitch-feat-akon/693246512');
      assert.equal(room.state.queue[0] && room.state.queue[0].videoId, 'am:song:1715687117');
      room.destroy();
    });

    it('reports a catalog outage as an error', async () => {
      useCatalog({ fail: true });
      const room = appleRoom();
      const ws = guestWs();
      await suggest(room, ws, 'new rules');
      assert.equal(lastOf(ws, 'error').code, 'APPLE_MUSIC_CATALOG_ERROR');
      room.destroy();
    });

    it('checks Apple keys against the catalog, never YouTube', async () => {
      useCatalog({ items: [video(1, 'Still There')] });
      const room = appleRoom();
      const result = await room.checkVideoAvailability(['am:video:1', 'am:video:2']);
      assert.deepEqual(result.get('am:video:1'), { title: 'Still There', artist: 'Dua Lipa', thumbnail: 'https://example.com/a.jpg', duration: 221 });
      assert.equal(result.has('am:video:2'), false, 'confirmed gone in this storefront');
      assert.equal(db.getVideo('am:video:1').title, 'Still There');

      useCatalog({ fail: true });
      const unchecked = await room.checkVideoAvailability(['am:video:1']);
      assert.equal(unchecked.has('am:video:1'), true);
      assert.equal(unchecked.get('am:video:1'), null);
      room.destroy();
    });

    it('pauses on host-side errors and skips only unplayable items', async () => {
      useCatalog();
      const room = appleRoom();
      const owner = ownerWs();
      room.addClient(owner);
      const first = { ...video(1, 'First'), id: 'q1', score: 0, voters: {} };
      const second = { ...video(2, 'Second'), id: 'q2', score: 0, voters: {} };
      room.state.currentTrack = { ...first, startedAt: Date.now() };
      room.state.queue = [room.state.currentTrack, second];
      room.state.isPlaying = true;

      await room.handleMessage(owner, { type: 'PLAYBACK_ERROR', payload: { videoId: 'am:video:1', errorCode: 'SUBSCRIPTION_ERROR' } });
      assert.equal(room.state.isPlaying, false);
      assert.equal(room.state.currentTrack.videoId, 'am:video:1');
      assert.deepEqual(lastOf(owner, 'APPLE_PLAYBACK_PROBLEM').payload, { code: 'SUBSCRIPTION_ERROR' });

      await room.handleMessage(owner, { type: 'PLAYBACK_ERROR', payload: { videoId: 'am:video:1', errorCode: 'CONTENT_UNAVAILABLE' } });
      assert.equal(room.state.currentTrack.videoId, 'am:video:2');

      await room.handleMessage(owner, { type: 'PLAYBACK_ERROR', payload: { videoId: { bad: true } } });
      assert.equal(room.state.currentTrack.videoId, 'am:video:2', 'malformed payloads are ignored');
      room.destroy();
    });

    it('keeps an item the storefront does not offer out of history and the Auto-DJ', async () => {
      useCatalog({ items: [video(2, 'Second')] });
      const room = appleRoom();
      const owner = ownerWs();
      room.addClient(owner);
      const unplayable = { ...song(693246512, 'Not in NL'), id: 'q1', score: 0, voters: {} };
      // An earlier failure had already put it into the history the Auto-DJ draws from.
      room.state.history = [{ ...unplayable, playedAt: Date.now() - 60000 }, { ...video(2, 'Second'), playedAt: Date.now() - 50000 }];
      room.state.autoRefill = true;
      room.state.currentTrack = { ...unplayable, startedAt: Date.now() };
      room.state.queue = [room.state.currentTrack];
      room.state.isPlaying = true;

      await room.handleMessage(owner, { type: 'PLAYBACK_ERROR', payload: { videoId: 'am:song:693246512', errorCode: 'NOT_FOUND' } });
      await new Promise(resolve => setImmediate(resolve));

      assert.equal(room.state.history.some(t => t.videoId === 'am:song:693246512'), false, 'not in history');
      assert.equal(room.state.queue.some(t => t.videoId === 'am:song:693246512'), false, 'not queued again');
      room.destroy();
    });

    it('does not let a second click on the end of the bar skip the next track too', async () => {
      useCatalog();
      const room = appleRoom();
      const owner = ownerWs();
      room.addClient(owner);
      const first = { ...video(1, 'First'), id: 'q1', score: 0, voters: {} };
      const second = { ...video(2, 'Second'), id: 'q2', score: 0, voters: {} };
      room.state.currentTrack = { ...first, startedAt: Date.now() - 60000 };
      room.state.queue = [room.state.currentTrack, second];
      room.state.isPlaying = true;

      // The first click seeks to the end, and the next tick moves on.
      await room.handleMessage(owner, { type: 'SEEK_TO', payload: 221 });
      room.tick();
      assert.equal(room.state.currentTrack.videoId, 'am:video:2');

      // The second click, a moment later, was aimed at the first track.
      await room.handleMessage(owner, { type: 'SEEK_TO', payload: 220.8 });
      room.tick();
      assert.equal(room.state.currentTrack.videoId, 'am:video:2', 'the next track keeps playing');
      assert.ok(room.state.progress < 5, 'from its start');

      // A deliberate seek on the new track still works.
      room.currentTrackSince = Date.now() - 3000;
      await room.handleMessage(owner, { type: 'SEEK_TO', payload: 100 });
      assert.equal(room.state.progress, 100);
      room.destroy();
    });

    const playing = (room, tracks) => {
      room.state.queue = tracks.map((t, i) => ({ ...t, id: `q${i + 1}`, score: 0, voters: {} }));
      room.state.currentTrack = { ...room.state.queue[0], startedAt: Date.now() };
      room.state.queue[0] = room.state.currentTrack;
      room.state.isPlaying = true;
    };

    it('pauses at the third item error in a row instead of skipping the whole queue', async () => {
      useCatalog();
      const room = appleRoom();
      const owner = ownerWs();
      room.addClient(owner);
      playing(room, [video(1, 'One'), video(2, 'Two'), video(3, 'Three'), video(4, 'Four')]);

      for (const id of [1, 2]) {
        await room.handleMessage(owner, { type: 'PLAYBACK_ERROR', payload: { videoId: `am:video:${id}`, errorCode: 'CONTENT_UNSUPPORTED' } });
      }
      assert.equal(room.state.currentTrack.videoId, 'am:video:3');
      await room.handleMessage(owner, { type: 'PLAYBACK_ERROR', payload: { videoId: 'am:video:3', errorCode: 'CONTENT_UNSUPPORTED' } });
      assert.equal(room.state.currentTrack.videoId, 'am:video:3', 'kept');
      assert.equal(room.state.isPlaying, false, 'paused');
      assert.deepEqual(lastOf(owner, 'APPLE_PLAYBACK_PROBLEM').payload, { code: 'CONTENT_UNSUPPORTED' });
      room.destroy();
    });

    it('treats a geo block as a problem on the host side', async () => {
      useCatalog();
      const room = appleRoom();
      const owner = ownerWs();
      room.addClient(owner);
      playing(room, [video(1, 'One'), video(2, 'Two')]);
      await room.handleMessage(owner, { type: 'PLAYBACK_ERROR', payload: { videoId: 'am:video:1', errorCode: 'GEO_BLOCK' } });
      assert.equal(room.state.currentTrack.videoId, 'am:video:1');
      assert.equal(room.state.isPlaying, false);
      room.destroy();
    });

    it('ignores an error or a duration reported for an earlier entry of the same song', async () => {
      useCatalog();
      const room = appleRoom();
      const owner = ownerWs();
      room.addClient(owner);
      playing(room, [video(1, 'Again'), video(1, 'Again'), video(2, 'Next')]);
      room.handleNextTrack();
      assert.equal(room.state.currentTrack.id, 'q2');

      await room.handleMessage(owner, { type: 'PLAYBACK_ERROR', payload: { videoId: 'am:video:1', errorCode: 'NOT_FOUND', trackId: 'q1' } });
      assert.equal(room.state.currentTrack.id, 'q2', 'not skipped');
      await room.handleMessage(owner, { type: 'UPDATE_DURATION', payload: { duration: 30, trackId: 'q1' } });
      assert.equal(room.state.currentTrack.duration, 221, 'duration untouched');
      room.destroy();
    });

    it('keeps the catalog length over the length the player reports', async () => {
      useCatalog();
      const room = appleRoom();
      const owner = ownerWs();
      room.addClient(owner);
      playing(room, [video(1, 'Known'), { ...video(2, 'Unknown'), duration: null }]);
      await room.handleMessage(owner, { type: 'UPDATE_DURATION', payload: { duration: 30, trackId: 'q1' } });
      assert.equal(room.state.currentTrack.duration, 221);

      room.handleNextTrack();
      await room.handleMessage(owner, { type: 'UPDATE_DURATION', payload: 187 });
      assert.equal(room.state.currentTrack.duration, 187, 'fills a missing length');
      room.destroy();
    });

    it('removes an unplayable item from the stored history as well', async () => {
      useCatalog();
      const room = appleRoom();
      const owner = ownerWs();
      room.addClient(owner);
      const unplayable = { ...song(693246512, 'Not in NL'), playedAt: Date.now() - 60000 };
      db.addToRoomHistory(room.id, unplayable);
      room.state.history = [unplayable];
      playing(room, [song(693246512, 'Not in NL'), video(2, 'Two')]);

      await room.handleMessage(owner, { type: 'PLAYBACK_ERROR', payload: { videoId: 'am:song:693246512', errorCode: 'NOT_FOUND' } });
      assert.equal(db.getRoomHistory(room.id).some(t => t.videoId === 'am:song:693246512'), false);
      room.destroy();
    });

    it('lets the Auto-DJ pick only checked, unbanned items, and nothing without a storefront', async () => {
      useCatalog({ items: [video(1, 'Fine'), video(2, 'Banned')] });
      const room = appleRoom();
      room.state.autoRefill = true;
      room.state.history = [video(1, 'Fine'), video(2, 'Banned'), video(3, 'Gone')].map(t => ({ ...t, playedAt: Date.now() - 60000 }));
      room.state.bannedVideos = [{ videoId: 'am:video:2', title: 'Banned' }];

      // No viewers: an Apple room still checks its picks.
      await room.populateQueueFromHistory();
      assert.deepEqual(room.state.queue.map(t => t.videoId), ['am:video:1']);
      assert.equal(room.state.currentTrack.videoId, 'am:video:1');
      assert.equal(room.state.history.some(t => t.videoId === 'am:video:3'), false, 'gone from history');
      room.destroy();

      const unconnected = appleRoom(null);
      unconnected.state.autoRefill = true;
      unconnected.state.history = [{ ...video(1, 'Fine'), playedAt: Date.now() - 60000 }];
      await unconnected.populateQueueFromHistory();
      assert.equal(unconnected.state.queue.length, 0);
      unconnected.destroy();
    });

    it('starts the refill even when play was pressed while it ran', async () => {
      useCatalog({ items: [video(1, 'Fine')] });
      const room = appleRoom();
      room.state.history = [{ ...video(1, 'Fine'), playedAt: Date.now() - 60000 }];
      room.state.isPlaying = true; // play pressed, nothing current
      await room.populateQueueFromHistory();
      assert.equal(room.state.currentTrack && room.state.currentTrack.videoId, 'am:video:1');
      room.destroy();
    });
  });
});
