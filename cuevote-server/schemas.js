// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
const { z } = require('zod');

const LoginPayload = z.object({
  token: z.string().min(1).max(4096),
});

const ResumeSessionPayload = z.object({
  token: z.string().min(1).max(256),
});

const LogoutPayload = z.object({
  token: z.string().min(1).max(256),
});

// bcrypt silently truncates the input at 72 bytes, so anything past
// that is ignored when hashing. Enforce 72 chars (≈72 bytes for ASCII
// pass-phrases, slightly less for multibyte UTF-8) in the schema so
// the limit is visible at validation time instead of being a surprise
// hidden inside bcrypt.compareSync.
const PASSWORD_MAX = 72;

const JoinRoomPayload = z.object({
  roomId: z.string().min(1).max(200),
  password: z.string().max(PASSWORD_MAX).optional(),
});

const CreateRoomPayload = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  color: z.string().max(100).optional(),
  isPrivate: z.boolean().optional(),
  password: z.string().max(PASSWORD_MAX).optional(),
  captionsEnabled: z.boolean().optional(),
  languageFlag: z.string().max(50).optional(),
});

const ListRoomsPayload = z.object({
  type: z.enum(['public', 'private', 'my_channels']).optional(),
  page: z.number().int().min(1).max(1000).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).optional();

const SuggestSongPayload = z.object({
  query: z.string().min(1).max(500),
});

const VotePayload = z.object({
  trackId: z.string().min(1).max(100),
  voteType: z.enum(['up', 'down']),
});

const SeekToPayload = z.number().finite().nonnegative();

const UpdateSettingsPayload = z.object({
  suggestionsEnabled: z.boolean().optional(),
  musicOnly: z.boolean().optional(),
  maxDuration: z.number().int().min(0).max(86400).optional(),
  allowPrelisten: z.boolean().optional(),
  ownerBypass: z.boolean().optional(),
  maxQueueSize: z.number().int().min(0).max(1000).optional(),
  smartQueue: z.boolean().optional(),
  playlistViewMode: z.boolean().optional(),
  suggestionMode: z.enum(['auto', 'manual']).optional(),
  ownerPopups: z.boolean().optional(),
  duplicateCooldown: z.number().int().min(0).max(1000).optional(),
  ownerQueueBypass: z.boolean().optional(),
  votesEnabled: z.boolean().optional(),
  autoApproveKnown: z.boolean().optional(),
  autoRefill: z.boolean().optional(),
  captionsEnabled: z.boolean().optional(),
  requireLogin: z.boolean().optional(),
}).refine(obj => Object.keys(obj).length > 0, {
  message: 'At least one setting must be provided',
});

const TrackIdPayload = z.object({
  trackId: z.string().min(1).max(100),
});

const VideoIdPayload = z.object({
  videoId: z.string().min(1).max(50),
});

// videoId is the related-videos cache KEY, so its shape is a security property:
// a free-form string lets a caller pick which cache entry gets written. Pin it
// to the YouTube id format. title/artist are deliberately absent — the server
// resolves those itself (see Room.handleFetchSuggestions); anything the client
// still sends is stripped here.
const FetchSuggestionsPayload = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
});

const UpdateDurationPayload = z.number().finite().positive().max(86400);

const PlayPausePayload = z.boolean();

// Remote DJ MCP: the web consent page sends this (over the user's authenticated
// socket) to approve an OAuth authorization. The server adds the user id and
// finalizes with the MCP server-to-server, so the finalize secret never reaches
// the browser.
const McpAuthorizePayload = z.object({
  handle: z.string().min(1).max(200),
  // What the consent page displayed. The MCP finalizes only if it matches the
  // authorization behind the handle.
  shownClient: z.string().max(1000).optional(),
  shownHost: z.string().max(300).optional(),
});

// A returning guest presents the token it was issued earlier; a first-time
// guest sends none and gets one back. 128 chars covers `<22-char id>.<43-char
// signature>` with room to spare.
const GuestSessionPayload = z.object({
  token: z.string().max(128).optional(),
}).optional();

const WebSocketMessage = z.object({
  type: z.string().min(1).max(50),
  payload: z.any().optional(),
  msgId: z.string().max(100).optional(),
});

module.exports = {
  LoginPayload,
  ResumeSessionPayload,
  LogoutPayload,
  JoinRoomPayload,
  CreateRoomPayload,
  ListRoomsPayload,
  SuggestSongPayload,
  VotePayload,
  SeekToPayload,
  UpdateSettingsPayload,
  TrackIdPayload,
  VideoIdPayload,
  FetchSuggestionsPayload,
  UpdateDurationPayload,
  PlayPausePayload,
  McpAuthorizePayload,
  GuestSessionPayload,
  WebSocketMessage,
};
