// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const schemas = require('../schemas');

describe('Zod Schemas', () => {
  describe('LoginPayload', () => {
    it('should accept valid token', () => {
      const result = schemas.LoginPayload.safeParse({ token: 'ya29.abcdef' });
      assert.ok(result.success);
    });

    it('should reject empty token', () => {
      const result = schemas.LoginPayload.safeParse({ token: '' });
      assert.ok(!result.success);
    });

    it('should reject missing token', () => {
      const result = schemas.LoginPayload.safeParse({});
      assert.ok(!result.success);
    });
  });

  describe('JoinRoomPayload', () => {
    it('should accept valid roomId', () => {
      const result = schemas.JoinRoomPayload.safeParse({ roomId: 'my-room-abc123' });
      assert.ok(result.success);
    });

    it('should accept roomId with password', () => {
      const result = schemas.JoinRoomPayload.safeParse({ roomId: 'room', password: 'secret' });
      assert.ok(result.success);
    });

    it('should reject empty roomId', () => {
      const result = schemas.JoinRoomPayload.safeParse({ roomId: '' });
      assert.ok(!result.success);
    });
  });

  describe('CreateRoomPayload', () => {
    it('should accept valid room creation', () => {
      const result = schemas.CreateRoomPayload.safeParse({
        name: 'My Room',
        description: 'A cool room',
        isPrivate: true,
        password: 'secret',
      });
      assert.ok(result.success);
    });

    it('should reject name over 100 chars', () => {
      const result = schemas.CreateRoomPayload.safeParse({ name: 'x'.repeat(101) });
      assert.ok(!result.success);
    });

    it('should reject missing name', () => {
      const result = schemas.CreateRoomPayload.safeParse({});
      assert.ok(!result.success);
    });
  });

  describe('VotePayload', () => {
    it('should accept valid upvote', () => {
      const result = schemas.VotePayload.safeParse({ trackId: 'abc-123', voteType: 'up' });
      assert.ok(result.success);
    });

    it('should accept valid downvote', () => {
      const result = schemas.VotePayload.safeParse({ trackId: 'abc-123', voteType: 'down' });
      assert.ok(result.success);
    });

    it('should reject invalid voteType', () => {
      const result = schemas.VotePayload.safeParse({ trackId: 'abc', voteType: 'sideways' });
      assert.ok(!result.success);
    });
  });

  describe('UpdateSettingsPayload', () => {
    it('should accept valid settings', () => {
      const result = schemas.UpdateSettingsPayload.safeParse({
        musicOnly: true,
        maxDuration: 600,
        maxQueueSize: 25,
      });
      assert.ok(result.success);
    });

    it('should reject empty object', () => {
      const result = schemas.UpdateSettingsPayload.safeParse({});
      assert.ok(!result.success);
    });

    it('should reject invalid suggestionMode', () => {
      const result = schemas.UpdateSettingsPayload.safeParse({ suggestionMode: 'chaos' });
      assert.ok(!result.success);
    });

    it('should reject negative maxDuration', () => {
      const result = schemas.UpdateSettingsPayload.safeParse({ maxDuration: -1 });
      assert.ok(!result.success);
    });
  });

  describe('SuggestSongPayload', () => {
    it('should accept valid query', () => {
      const result = schemas.SuggestSongPayload.safeParse({ query: 'rick astley' });
      assert.ok(result.success);
    });

    it('should accept YouTube URL', () => {
      const result = schemas.SuggestSongPayload.safeParse({
        query: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      });
      assert.ok(result.success);
    });

    it('should reject empty query', () => {
      const result = schemas.SuggestSongPayload.safeParse({ query: '' });
      assert.ok(!result.success);
    });
  });

  describe('FetchSuggestionsPayload', () => {
    it('should accept a YouTube video id', () => {
      const result = schemas.FetchSuggestionsPayload.safeParse({ videoId: 'dQw4w9WgXcQ' });
      assert.ok(result.success);
    });

    // videoId is the related-videos cache key. A free-form string would let a
    // caller choose which cache entry gets overwritten.
    it('should reject a free-form cache key', () => {
      const result = schemas.FetchSuggestionsPayload.safeParse({ videoId: 'not-a-video-id' });
      assert.ok(!result.success);
    });

    it('should reject the wrong length', () => {
      assert.ok(!schemas.FetchSuggestionsPayload.safeParse({ videoId: 'dQw4w9WgXc' }).success);
      assert.ok(!schemas.FetchSuggestionsPayload.safeParse({ videoId: 'dQw4w9WgXcQQ' }).success);
    });

    // The server resolves title/artist itself; anything sent here is stripped
    // rather than passed through to the search query.
    it('should strip client-supplied title and artist', () => {
      const result = schemas.FetchSuggestionsPayload.safeParse({
        videoId: 'dQw4w9WgXcQ',
        title: 'attacker chosen',
        artist: 'attacker chosen',
      });
      assert.ok(result.success);
      assert.deepEqual(result.data, { videoId: 'dQw4w9WgXcQ' });
    });
  });

  describe('WebSocketMessage', () => {
    it('should accept valid message', () => {
      const result = schemas.WebSocketMessage.safeParse({
        type: 'VOTE',
        payload: { trackId: '123', voteType: 'up' },
        msgId: 'msg-1',
      });
      assert.ok(result.success);
    });

    it('should accept message without payload', () => {
      const result = schemas.WebSocketMessage.safeParse({ type: 'PING' });
      assert.ok(result.success);
    });

    it('should reject missing type', () => {
      const result = schemas.WebSocketMessage.safeParse({ payload: {} });
      assert.ok(!result.success);
    });

    it('should reject empty type', () => {
      const result = schemas.WebSocketMessage.safeParse({ type: '' });
      assert.ok(!result.success);
    });
  });

  describe('SeekToPayload', () => {
    it('should accept valid number', () => {
      assert.ok(schemas.SeekToPayload.safeParse(42.5).success);
    });

    it('should reject negative', () => {
      assert.ok(!schemas.SeekToPayload.safeParse(-1).success);
    });

    it('should reject NaN', () => {
      assert.ok(!schemas.SeekToPayload.safeParse(NaN).success);
    });

    it('should reject Infinity', () => {
      assert.ok(!schemas.SeekToPayload.safeParse(Infinity).success);
    });
  });

  describe('McpAuthorizePayload', () => {
    it('should accept a handle with the displayed client and host', () => {
      const result = schemas.McpAuthorizePayload.safeParse({ handle: 'abc', shownClient: 'Some DJ', shownHost: 'ai.example' });
      assert.ok(result.success);
      assert.equal(result.data.shownHost, 'ai.example');
    });

    it('should accept a handle alone', () => {
      assert.ok(schemas.McpAuthorizePayload.safeParse({ handle: 'abc' }).success);
    });

    it('should reject a non-string host', () => {
      assert.ok(!schemas.McpAuthorizePayload.safeParse({ handle: 'abc', shownHost: 42 }).success);
    });

    it('should reject an overlong host', () => {
      assert.ok(!schemas.McpAuthorizePayload.safeParse({ handle: 'abc', shownHost: 'a'.repeat(301) }).success);
    });
  });
});
