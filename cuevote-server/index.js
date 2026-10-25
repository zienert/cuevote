// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
require('dotenv').config();
const logger = require('./logger');
logger.info("Server starting...");
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    // In production, crash so the process manager can restart cleanly.
    if (process.env.NODE_ENV === 'production') {
        try {
            setTimeout(() => process.exit(1), 100);
        } catch {
            process.exit(1);
        }
    }
});

const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");
const bcrypt = require('bcryptjs');
const { slugify } = require('transliteration');
const db = require('./db');
const dbAsync = require('./db-async');
const gdpr = require('./gdpr');
const guest = require('./guest');
const clientIp = require('./client-ip');
const adminApi = require('./admin');
const backupScheduler = require('./backup_scheduler');
backupScheduler.start();

// Ensure global fetch is available (Node 18+ or polyfilled).
if (typeof fetch !== 'function') {
    logger.error('[Startup] global.fetch is not available. Require Node.js 18+ or a fetch polyfill.');
    process.exit(1);
}

function redactForLog(value) {
    if (value === undefined || value === null || value === '') return '[REDACTED]';
    return '[REDACTED]';
}

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [];

const server = http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
    }
    // RFC 9116 security contact. Expires is computed per request (~10 months out,
    // always < 1 year), so it never lapses regardless of deploy cadence or uptime.
    // GET and HEAD both answer (HEAD returns the headers only), like a static file.
    if ((req.method === 'GET' || req.method === 'HEAD') && req.url === '/.well-known/security.txt') {
        const expires = new Date(Date.now() + 300 * 24 * 60 * 60 * 1000).toISOString();
        const body =
            'Contact: mailto:security@cuevote.com\n' +
            'Expires: ' + expires + '\n' +
            'Preferred-Languages: en\n' +
            'Canonical: https://cuevote.com/.well-known/security.txt\n' +
            'Policy: https://github.com/zienert/cuevote/blob/main/SECURITY.md\n';
        res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Length': Buffer.byteLength(body),
            'Cache-Control': 'public, max-age=86400',
        });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
    }
    res.writeHead(404);
    res.end();
});

const wss = new WebSocket.Server({
    server,
    perMessageDeflate: false,
    maxPayload: 64 * 1024, // 64 KB — prevents DoS via oversized messages
    verifyClient: (info, cb) => {
        if (ALLOWED_ORIGINS.length === 0) {
            if (process.env.NODE_ENV === 'production') {
                logger.error('[Security] No ALLOWED_ORIGINS configured in production. Rejecting connection.');
                return cb(false, 503, 'Origin configuration required');
            }
            return cb(true);
        }

        const origin = info.origin;
        if (ALLOWED_ORIGINS.includes(origin)) {
            return cb(true);
        }

        logger.info(`[Security] Blocked connection from unauthorized origin: ${origin}`);
        return cb(false, 403, 'Forbidden');
    }
});
wss.on('error', (err) => {
    logger.error('[WSS] WebSocket server error:', err);
});

server.listen(process.env.PORT || 8080, '0.0.0.0');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_IOS_CLIENT_ID = process.env.GOOGLE_IOS_CLIENT_ID;
const VALID_GOOGLE_CLIENT_IDS = [GOOGLE_CLIENT_ID, GOOGLE_IOS_CLIENT_ID].filter(Boolean);

async function verifyGoogleToken(token) {
    try {
        const tokenInfoRes = await fetch(
            `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`
        );
        if (!tokenInfoRes.ok) {
            throw new Error('Invalid or expired access token');
        }
        const tokenInfo = await tokenInfoRes.json();
        if (!VALID_GOOGLE_CLIENT_IDS.includes(tokenInfo.aud)) {
            throw new Error('Token was not issued for this application');
        }

        const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch user info');
        }

        const data = await response.json();
        return data;
    } catch (error) {
        logger.error("Token verification failed:", error);
        throw error;
    }
}

const Room = require('./Room');
const schemas = require('./schemas');

// Room Manager
const rooms = new Map();

// Default rooms removed

// Initialize system user (rooms are loaded on-demand via JOIN_ROOM)
function loadRooms() {
    try {
        db.upsertUser({
            id: 'system',
            email: 'system@cuevote.com',
            name: 'System',
            picture: ''
        });
    } catch (e) { logger.error("System user init failed", e); }
}

loadRooms();

// Localhost-only admin API for ops tooling (no-op unless ADMIN_TOKEN is set).
adminApi.start({ rooms });

const clients = new Set();

// A socket that was a guest and has just signed in: hand its votes to the
// account. Guest ids never appear in `users`, so nothing else would ever
// reconcile them, and the queue would show the person's own votes as somebody
// else's while letting them vote again.
function adoptGuestIdentity(ws, previousIdentity) {
    if (!guest.isGuestUser(previousIdentity)) return;
    if (!ws.user || ws.user.id === previousIdentity.id) return;
    ws.guestToken = undefined;
    if (!ws.roomId || !rooms.has(ws.roomId)) return;
    try {
        rooms.get(ws.roomId).mergeIdentity(previousIdentity.id, ws.user.id, ws.user.name);
    } catch (e) {
        logger.error({ err: e }, '[Identity] Failed to merge a guest identity into an account');
    }
}

// Per-IP socket cap. The existing per-socket message rate limit
// (60 msg / 10s) is trivially bypassed by opening many sockets;
// this caps the concurrent footprint. Generous default (20) covers
// a normal user with several tabs and the mobile app open at once,
// while a single misbehaving client maxes out at 20× the per-socket
// quota instead of unlimited.
const MAX_SOCKETS_PER_IP = parseInt(process.env.MAX_SOCKETS_PER_IP || '20', 10);
const ipSocketCount = new Map(); // ip -> active socket count

// A guest identity is what keeps one person from voting a track up repeatedly,
// so minting them has to cost something. A socket gets exactly one (see
// GUEST_SESSION); this caps how many a single address can obtain by churning
// connections. A device mints once and then re-presents its stored token, so
// the budget is consumed by NEW devices — 60 per 10 minutes behind one NAT
// covers a large party while bounding a script.
const MAX_GUEST_MINTS_PER_IP = parseInt(process.env.MAX_GUEST_MINTS_PER_IP || '60', 10);
const GUEST_MINT_WINDOW_MS = 10 * 60 * 1000;
const guestMintsByIp = new Map(); // ip -> { count, windowStart }

function claimGuestMint(ip) {
    const now = Date.now();
    const entry = guestMintsByIp.get(ip);
    if (!entry || now - entry.windowStart > GUEST_MINT_WINDOW_MS) {
        guestMintsByIp.set(ip, { count: 1, windowStart: now });
        return true;
    }
    if (entry.count >= MAX_GUEST_MINTS_PER_IP) return false;
    entry.count++;
    return true;
}

// The map only grows while an address keeps minting; drop windows that lapsed.
setInterval(() => {
    const cutoff = Date.now() - GUEST_MINT_WINDOW_MS;
    for (const [ip, entry] of guestMintsByIp) {
        if (entry.windowStart < cutoff) guestMintsByIp.delete(ip);
    }
}, GUEST_MINT_WINDOW_MS).unref();

// The address each connection counts under: the visitor's, not the Cloudflare
// edge server's or a header a direct client made up. See client-ip.js.
const getClientIp = clientIp.resolverFromEnv();

logger.info("WebSocket server started on port", process.env.PORT || 8080);

wss.on("connection", (ws, req) => {
    // Per-IP socket cap (before any other work — fail fast).
    const ip = getClientIp(req);
    const ipCount = ipSocketCount.get(ip) || 0;
    if (ipCount >= MAX_SOCKETS_PER_IP) {
        logger.warn(`[RateLimit] IP ${ip} exceeded socket cap (${ipCount}/${MAX_SOCKETS_PER_IP}). Rejecting connection.`);
        try {
            ws.send(JSON.stringify({ type: "error", code: "IP_RATE_LIMIT", message: "Too many connections from this network. Please try again later." }));
            ws.close(1013, 'Too many connections from this IP');
        } catch { /* socket already dead */ }
        return;
    }
    ipSocketCount.set(ip, ipCount + 1);
    ws.ip = ip; // marker that this socket is counted

    // Parse Client ID
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const clientId = urlParams.get('clientId');

    if (clientId) {
        ws.id = clientId;
        for (const existing of clients) {
            if (existing.id === clientId && existing !== ws) {
                logger.info(`[Reconnect] Evicting stale socket for clientId: ${clientId}`);
                if (existing.roomId) {
                    ws.lastRoomId = existing.roomId;
                    if (rooms.has(existing.roomId)) {
                        rooms.get(existing.roomId).removeClient(existing);
                    }
                }
                // Do NOT inherit existing.user — clientId travels in URL params
                // (referers, access logs, browser history) and is therefore not
                // an auth factor. The client re-sends RESUME_SESSION with the
                // session token on every reconnect (WebSocketProvider.jsx),
                // which is the only path that should set ws.user.
                clients.delete(existing);
                existing.terminate();
            }
        }
    } else {
        ws.id = crypto.randomUUID();
    }

    logger.info(`Client connected (id: ${ws.id})`);

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws._msgCount = 0;
    ws._msgWindowStart = Date.now();

    clients.add(ws);

    // Default Join (Lobby or specific room)
    // REMOVED: Do not auto-join "synthwave". Wait for explicit JOIN_ROOM.
    /*
    const defaultRoomId = "synthwave";
    const room = rooms.get(defaultRoomId);
    if (room) {
        ws.roomId = defaultRoomId;
        room.addClient(ws);
    }
    */

    ws.on("message", async (message) => {
        try {
            // Per-message rate limit: 60 messages per 10 seconds per socket
            const now = Date.now();
            if (now - ws._msgWindowStart > 10000) {
                ws._msgCount = 0;
                ws._msgWindowStart = now;
            }
            ws._msgCount++;
            if (ws._msgCount > 60) {
                ws.send(JSON.stringify({ type: "error", message: "Rate limit exceeded. Please slow down." }));
                return;
            }

            const raw = JSON.parse(message);
            const envelopeResult = schemas.WebSocketMessage.safeParse(raw);
            if (!envelopeResult.success) {
                ws.send(JSON.stringify({ type: "error", message: "Invalid message format." }));
                return;
            }
            const parsedMessage = envelopeResult.data;
            const msgId = parsedMessage.msgId;

            const sendAck = () => {
                if (msgId && ws.readyState === 1) {
                    ws.send(JSON.stringify({ type: "ACK", msgId }));
                }
            };

            // Handle Global Messages (Auth, Routing)
            switch (parsedMessage.type) {
                case "LOGIN": {
                    const loginResult = schemas.LoginPayload.safeParse(parsedMessage.payload);
                    if (!loginResult.success) {
                        ws.send(JSON.stringify({ type: "error", message: "Invalid login payload." }));
                        return;
                    }
                    sendAck();
                    const { token } = loginResult.data;
                        logger.info("[LOGIN TRACE] Processing login request...");
                        try {
                            const payload = await verifyGoogleToken(token);
                            logger.info(`[LOGIN TRACE] Token verified for Google Subject: ${redactForLog(payload.sub)}`);

                        const userData = {
                            id: payload.sub,
                            email: payload.email,
                            name: payload.name,
                            picture: payload.picture
                        };

                        // Generate Session Token
                        const sessionToken = crypto.randomBytes(32).toString('hex');
                        const expiresAt = Math.floor(Date.now() / 1000) + (24 * 60 * 60); // 24 hours

                        // Atomic: upsert user + create session in one transaction
                        logger.info("[LOGIN TRACE] Creating user and session...");
                        const previousIdentity = ws.user;
                        try {
                            ws.user = db.loginUser(userData, sessionToken, expiresAt);
                            logger.info("[LOGIN TRACE] Login transaction successful.");
                        } catch (dbErr) {
                            logger.error("[LOGIN CRITICAL] Login transaction failed:", dbErr);
                            throw dbErr;
                        }

                        logger.info("[LOGIN TRACE] Sending LOGIN_SUCCESS");
                        ws.send(JSON.stringify({
                            type: "LOGIN_SUCCESS",
                            payload: { user: ws.user, sessionToken }
                        }));
                        // Carry the guest's votes over to the account, so signing
                        // in mid-party neither loses them nor lets the same person
                        // vote a second time on a track they already voted on.
                        adoptGuestIdentity(ws, previousIdentity);
                        // The room state this socket already holds was built for
                        // a guest, so it carries no myVote. Re-send it now that we
                        // know who they are.
                        if (ws.roomId && rooms.has(ws.roomId)) rooms.get(ws.roomId).sendStateTo(ws);
                    } catch (e) {
                        logger.error("[LOGIN FAILURE] Error Details:", e);
                        ws.send(JSON.stringify({ type: "error", message: "Login failed. Please try again." }));
                    }
                    return;
                }
                case "GUEST_SESSION": {
                    // A guest identity is what lets someone who scanned the QR
                    // code vote without an account.
                    //
                    // A socket gets exactly ONE, for the whole reason the
                    // identity exists: it keys `track.voters`, so a socket able
                    // to mint a second one can vote on the same track twice.
                    // Sending this again is answered with the identity the
                    // socket already has, never a new one — a signed-in user is
                    // likewise never downgraded to a guest.
                    if (guest.hasAccount(ws)) {
                        sendAck();
                        return;
                    }

                    const guestResult = schemas.GuestSessionPayload.safeParse(parsedMessage.payload);
                    if (!guestResult.success) {
                        ws.send(JSON.stringify({ type: "error", message: "Invalid guest session payload." }));
                        return;
                    }
                    sendAck();

                    if (guest.isGuestUser(ws.user)) {
                        // Re-affirm, do not re-mint. The client may send this
                        // more than once (queued message after a reconnect, a
                        // logout that races the socket opening).
                        ws.send(JSON.stringify({
                            type: "GUEST_SESSION_OK",
                            payload: { user: ws.user, guestToken: ws.guestToken }
                        }));
                        return;
                    }

                    const presented = guestResult.data?.token;
                    let guestId = presented ? guest.verifyToken(presented) : null;
                    let guestToken = presented;

                    if (!guestId) {
                        if (!claimGuestMint(ws.ip)) {
                            logger.warn(`[RateLimit] IP ${ws.ip} exhausted its guest identity budget (${MAX_GUEST_MINTS_PER_IP} per ${GUEST_MINT_WINDOW_MS / 60000} min).`);
                            ws.send(JSON.stringify({
                                type: "error",
                                code: "GUEST_LIMIT",
                                message: "Too many new guests from this network. Please sign in to continue."
                            }));
                            return;
                        }
                        guestToken = guest.issueToken();
                        guestId = guest.verifyToken(guestToken);
                    }

                    ws.user = guest.userFromId(guestId);
                    ws.guestToken = guestToken;
                    ws.send(JSON.stringify({
                        type: "GUEST_SESSION_OK",
                        payload: { user: ws.user, guestToken }
                    }));
                    // Same reason as LOGIN: the state this socket already holds
                    // was projected for nobody, so it carries no myVote.
                    if (ws.roomId && rooms.has(ws.roomId)) rooms.get(ws.roomId).sendStateTo(ws);
                    return;
                }
                case "RESUME_SESSION": {
                    const resumeResult = schemas.ResumeSessionPayload.safeParse(parsedMessage.payload);
                    if (!resumeResult.success) {
                        logger.warn(`[Resume Session] Invalid payload schema (clientId: ${ws.id})`);
                        ws.send(JSON.stringify({ type: "SESSION_INVALID" }));
                        return;
                    }
                    sendAck();
                    const { token } = resumeResult.data;
                    logger.info(`[Resume Session] Received (clientId: ${ws.id})`);
                    const session = db.getSession(token);
                    if (session) {
                        const user = db.getUser(session.user_id);
                        if (user) {
                            const previousIdentity = ws.user;
                            ws.user = user;
                            adoptGuestIdentity(ws, previousIdentity);
                            const resumePayload = { user: ws.user, sessionToken: token };
                            if (ws.lastRoomId) resumePayload.lastRoomId = ws.lastRoomId;
                            logger.info(`[Resume Session] OK — user resumed (clientId: ${ws.id})`);
                            ws.send(JSON.stringify({
                                type: "LOGIN_SUCCESS",
                                payload: resumePayload
                            }));
                            if (ws.roomId && rooms.has(ws.roomId)) rooms.get(ws.roomId).sendStateTo(ws);
                        } else {
                            // Session exists but user is gone (deleted?)
                            logger.warn(`[Resume Session] Session found but user ${redactForLog(session.user_id)} is missing. Invalidating.`);
                            db.deleteSession(token);
                            ws.send(JSON.stringify({ type: "SESSION_INVALID" }));
                        }
                    } else {
                        logger.info(`[Resume Session] Token not in DB → SESSION_INVALID (clientId: ${ws.id})`);
                        ws.send(JSON.stringify({ type: "SESSION_INVALID" }));
                    }
                    return;
                }
                case "LOGOUT": {
                    const logoutResult = schemas.LogoutPayload.safeParse(parsedMessage.payload);
                    if (logoutResult.success) {
                        db.deleteSession(logoutResult.data.token);
                    } else {
                        // A malformed LOGOUT used to silently no-op the DB
                        // delete while still clearing ws.user, so the client
                        // would think they were logged out but the session
                        // stayed valid for its 24h lifetime. Log the schema
                        // mismatch so we notice if a client regresses.
                        logger.warn(`[Logout] Invalid payload (clientId: ${ws.id}). Session token not invalidated.`);
                    }
                    ws.user = null;
                    // Same reason as on login: the state this socket holds still
                    // shows the previous identity's votes.
                    if (ws.roomId && rooms.has(ws.roomId)) rooms.get(ws.roomId).sendStateTo(ws);
                    return;
                }


                // ... existing code ...

                case "DELETE_ACCOUNT": {
                    logger.info("[SERVER TRACE] DELETE_ACCOUNT received");
                    // Guests have no account to erase: no users row, no sessions,
                    // nothing but a signed random id. Letting one through ran a
                    // full-table room_state scan plus a WAL checkpoint per message.
                    if (!guest.hasAccount(ws)) {
                        logger.info(`[GDPR] DELETE_ACCOUNT refused: socket has no account. WS ID: ${ws.id}`);
                        ws.send(JSON.stringify({ type: "error", code: "ACCOUNT_REQUIRED", message: "Not logged in." }));
                        return;
                    }
                    const userId = ws.user.id;
                    logger.info(`[GDPR] Deleting account for user: ${redactForLog(userId)}`);

                    // 1. Delete from DB (Synchronous Transaction)
                    try {
                        logger.info(`[GDPR TRACE] Starting DB Deletion for ${redactForLog(userId)}...`);

                        // Debug: Count before
                        const beforeRooms = db.listUserRooms(userId);
                        logger.info(`[GDPR PRE-CHECK] User owns ${beforeRooms.length} rooms in DB.`);

                        const success = db.deleteUser(userId);
                        logger.info(`[GDPR TRACE] DB Deletion execution success: ${success}`);

                        // Post-check that the erasure actually took. listUserRooms
                        // reads `rooms` by owner_id without joining `users`, so an
                        // empty result here means the rooms are gone — not merely
                        // that the user row is.
                        const afterRooms = db.listUserRooms(userId);
                        logger.info(`[GDPR POST-CHECK] User owns ${afterRooms.length} rooms in DB. (Should be 0)`);

                    } catch (e) {
                        logger.info(`[GDPR ERROR] Failed to delete user from DB: ${e.message}`);
                        logger.error("Failed to delete user from DB", e);
                        ws.send(JSON.stringify({ type: "error", message: "Failed to delete account data." }));
                        return;
                    }

                    // 2 + 2b. Destroy owned rooms and scrub the user's PII from
                    // every remaining loaded room. Shared with the admin GDPR
                    // endpoint so both paths behave identically (see gdpr.js).
                    const purge = gdpr.purgeUserFromMemory(rooms, userId);
                    logger.info(`[GDPR] Memory purge — destroyed ${purge.destroyedRooms.length} room(s), scrubbed ${purge.scrubbedRooms}.`);

                    // 3. Success
                    logger.info("[GDPR TRACE] Sending DELETE_ACCOUNT_SUCCESS");
                    ws.send(JSON.stringify({ type: "DELETE_ACCOUNT_SUCCESS" }));
                    ws.user = null;
                    return;
                }
                case "STATE_ACK": {
                    logger.info(`[SERVER TRACE] Client ${ws.id} ACKNOWLEDGED state for room: ${parsedMessage.payload.roomId}`);
                    return;
                }
                case "JOIN_ROOM": {
                    const joinResult = schemas.JoinRoomPayload.safeParse(parsedMessage.payload);
                    if (!joinResult.success) {
                        ws.send(JSON.stringify({ type: "error", message: "Invalid room ID." }));
                        return;
                    }
                    const { roomId, password } = joinResult.data;
                    logger.info(`[SERVER TRACE] Client ${ws.id} requesting to join room: ${roomId}`);

                    // Leave ALL rooms to ensure no duplicate subscriptions
                    for (const [id, room] of rooms.entries()) {
                        if (room.clients.has(ws)) {
                            logger.info(`[SERVER TRACE] Client ${ws.id} leaving room (forced cleanup): ${id}`);
                            room.removeClient(ws);
                        }
                    }

                    // Try to resolve room
                    let room = rooms.get(roomId) || rooms.get(roomId.toLowerCase()) || rooms.get(roomId.toUpperCase());

                    if (!room) {
                        try {
                            const roomData = db.getRoom(roomId) || db.getRoom(roomId.toLowerCase()) || db.getRoom(roomId.toUpperCase());
                            if (roomData) {
                                const resolvedId = roomData.id;
                                logger.info(`Waking up idle room: ${roomData.name} (${resolvedId})`);
                                room = new Room(resolvedId, roomData.name, YOUTUBE_API_KEY, roomData);
                                rooms.set(resolvedId, room);
                            }
                        } catch (e) {
                            logger.error("DB Lookup failed", e);
                        }
                    }

                    if (room) {
                        // Password Check
                        if (room.metadata.password) {
                            const isOwner = ws.user && ws.user.id === room.metadata.owner_id;
                            if (!isOwner && (!password || !bcrypt.compareSync(password, room.metadata.password))) {
                                ws.send(JSON.stringify({ type: "error", code: "PASSWORD_REQUIRED", message: "Password required" }));
                                return;
                            }
                        }

                        logger.info(`Client ${ws.id} joining room: ${room.id}`);
                        ws.roomId = room.id;
                        room.addClient(ws);
                        db.updateRoomActivity(room.id);
                        sendAck();
                    } else {
                        ws.send(JSON.stringify({ type: "error", code: "ROOM_NOT_FOUND", message: "Room not found" }));
                    }
                    return;
                }
                case "CREATE_ROOM": {
                    // rooms.owner_id is a foreign key into users, so a guest id
                    // cannot own a room — refuse here rather than after bcrypt has
                    // run and the insert has failed on the constraint.
                    if (!guest.hasAccount(ws)) {
                        ws.send(JSON.stringify({ type: "error", code: "ACCOUNT_REQUIRED", message: "You must be logged in to create a room." }));
                        return;
                    }
                    const createResult = schemas.CreateRoomPayload.safeParse(parsedMessage.payload);
                    if (!createResult.success) {
                        ws.send(JSON.stringify({ type: "error", message: "Invalid room data. Name is required (max 100 chars)." }));
                        return;
                    }
                    const { name, description, color, isPrivate, password, captionsEnabled, languageFlag } = createResult.data;

                    let attempts = 0;
                    let success = false;
                    while (attempts < 3 && !success) {
                        attempts++;
                        const id = slugify(name, { lowercase: true, separator: '-' }) + '-' + crypto.randomBytes(8).toString('hex');

                        try {
                            const roomData = {
                                id,
                                name,
                                description: description || "Community Station",
                                owner_id: ws.user.id,
                                color: color || "from-gray-700 to-black",
                                is_public: isPrivate ? 0 : 1,
                                password: (isPrivate && password) ? bcrypt.hashSync(password, 10) : null,
                                captions_enabled: captionsEnabled ? 1 : 0,
                                language_flag: languageFlag || 'international'
                            };

                            db.createRoom(roomData);
                            rooms.set(id, new Room(id, name, YOUTUBE_API_KEY, roomData));

                            const { password: _hash, ...safeRoomData } = roomData;
                            ws.send(JSON.stringify({ type: "ROOM_CREATED", payload: safeRoomData }));
                            success = true;
                        } catch (err) {
                            if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
                                logger.warn(`[Create Room] ID Collision for ${id}. Retrying... (${attempts}/3)`);
                                continue;
                            }
                            logger.error("Create Room Error:", err);
                            ws.send(JSON.stringify({ type: "error", message: "Failed to create room." }));
                            return; // Exit on non-collision error
                        }
                    }

                    if (!success) {
                        ws.send(JSON.stringify({ type: "error", message: "Failed to generate a unique channel ID. Please try again." }));
                    }
                    return;
                }
                case "LIST_ROOMS": {
                    const listResult = schemas.ListRoomsPayload.safeParse(parsedMessage.payload);
                    const listPayload = listResult.success ? (listResult.data || {}) : {};
                    const showPrivate = listPayload.type === 'private';
                    const showMyChannels = listPayload.type === 'my_channels';
                    const pageSize = listPayload.limit || 50;
                    const page = listPayload.page || 1;
                    const offset = (page - 1) * pageSize;

                    if (showMyChannels) {
                        logger.debug(`[DEBUG_MARATHON] LIST_ROOMS (My Channels) requested by: ${redactForLog(ws.user?.id)}`);
                    }

                    if (showMyChannels && !ws.user) {
                        ws.send(JSON.stringify({ type: "ROOM_LIST", payload: [], page: 1, totalPages: 0, total: 0 }));
                        return;
                    }

                    const roomList = [];
                    // 1. Get from Memory (Active)
                    for (const room of rooms.values()) {
                        if (room.deleted) continue;
                        if (showMyChannels) {
                            if (room.metadata.owner_id === ws.user.id) {
                                roomList.push(room.getSummary());
                            }
                        } else {
                            const isPublic = room.metadata.is_public === 1;
                            if ((showPrivate && !isPublic) || (!showPrivate && isPublic)) {
                                if (showPrivate && !room.metadata.password) {
                                    continue;
                                }
                                roomList.push(room.getSummary());
                            }
                        }
                    }

                    // 2. Get from DB (idle rooms not in memory)
                    let dbRooms = [];
                    if (showMyChannels) {
                        dbRooms = db.listUserRooms(ws.user.id);
                        logger.debug(`[DEBUG_MARATHON] DB returned ${dbRooms.length} rooms for user ${redactForLog(ws.user?.id)}. IDs: ${dbRooms.map(r => r.id).join(', ')}`);
                    } else {
                        dbRooms = showPrivate ? db.listPrivateRooms() : db.listPublicRooms();
                    }

                    const activeIds = new Set(roomList.map(r => r.id));

                    dbRooms.forEach(dbr => {
                        if (!showMyChannels && showPrivate && !dbr.password) {
                            return;
                        }

                        if (!activeIds.has(dbr.id)) {
                            let lobbyPreview = null;
                            if (dbr.lobby_preview) {
                                const dormantSeconds = Math.floor(Date.now() / 1000) - (dbr.last_active_at || 0);
                                const TWENTY_EIGHT_DAYS_S = 28 * 24 * 60 * 60;
                                if (dormantSeconds <= TWENTY_EIGHT_DAYS_S) {
                                    try { lobbyPreview = JSON.parse(dbr.lobby_preview); } catch (e) { /* ignore */ }
                                }
                            }
                            roomList.push({
                                id: dbr.id,
                                name: dbr.name,
                                description: dbr.description,
                                color: dbr.color,
                                listeners: 0,
                                currentTrack: lobbyPreview,
                                is_protected: !!dbr.password,
                                isActive: false,
                                language_flag: dbr.language_flag || 'international'
                            });
                        }
                    });

                    // Patch active rooms with protection status
                    for (const roomItem of roomList) {
                        const activeRoom = rooms.get(roomItem.id);
                        if (activeRoom && activeRoom.metadata.password) {
                            roomItem.is_protected = true;
                        }
                    }

                    // Sort: active rooms first (by listener count desc), then idle rooms (by name)
                    roomList.sort((a, b) => {
                        if (a.isActive !== false && b.isActive === false) return -1;
                        if (a.isActive === false && b.isActive !== false) return 1;
                        return (b.listeners || 0) - (a.listeners || 0);
                    });

                    // Paginate the merged result
                    const total = roomList.length;
                    const totalPages = Math.ceil(total / pageSize);
                    const paginatedList = roomList.slice(offset, offset + pageSize);

                    ws.send(JSON.stringify({
                        type: "ROOM_LIST",
                        payload: paginatedList,
                        page,
                        totalPages,
                        total
                    }));
                    return;
                }
                case "DEBUG": {
                    if (process.env.NODE_ENV !== 'production') {
                        logger.info("[CLIENT DEBUG]", typeof parsedMessage.payload === 'string'
                            ? parsedMessage.payload.slice(0, 200)
                            : '[object]');
                    }
                    return;
                }
                case "PING": {
                    ws.send(JSON.stringify({ type: "PONG" }));
                    return;
                }
                case "MCP_AUTHORIZE": {
                    // Web consent page approving a remote-DJ OAuth authorization.
                    // The user is already authenticated on this socket; we add
                    // their id and finalize with the MCP server-to-server, so the
                    // finalize secret never reaches the browser.
                    const r = schemas.McpAuthorizePayload.safeParse(parsedMessage.payload);
                    if (!r.success) {
                        ws.send(JSON.stringify({ type: "error", message: "Invalid authorization request." }));
                        return;
                    }
                    // The grant is meant to let an AI act in a person's name. A
                    // guest identity is a browser-local random number, so binding
                    // one here burns the single-use handle and mints a grant whose
                    // every later tool call fails on a missing users row.
                    if (!guest.hasAccount(ws)) {
                        ws.send(JSON.stringify({ type: "error", code: "NOT_LOGGED_IN", message: "You must be signed in to connect an AI." }));
                        return;
                    }
                    sendAck();
                    const finalizeSecret = process.env.CUEVOTE_OAUTH_FINALIZE_SECRET;
                    if (!finalizeSecret) {
                        logger.warn('[MCP_AUTHORIZE] CUEVOTE_OAUTH_FINALIZE_SECRET not set — remote DJ OAuth disabled.');
                        ws.send(JSON.stringify({ type: "error", message: "AI connection is not available." }));
                        return;
                    }
                    const mcpUrl = (process.env.MCP_INTERNAL_URL || 'http://127.0.0.1:8082').replace(/\/$/, '');
                    try {
                        const res = await fetch(`${mcpUrl}/oauth/finalize`, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${finalizeSecret}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ handle: r.data.handle, userId: ws.user.id })
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok || !data.redirectTo) {
                            logger.warn(`[MCP_AUTHORIZE] finalize failed (status ${res.status})`);
                            ws.send(JSON.stringify({ type: "error", message: "Authorization expired or invalid. Please try again from your AI." }));
                            return;
                        }
                        ws.send(JSON.stringify({ type: "MCP_AUTHORIZE_RESULT", payload: { redirectTo: data.redirectTo } }));
                    } catch (e) {
                        logger.error('[MCP_AUTHORIZE] finalize error:', e);
                        ws.send(JSON.stringify({ type: "error", message: "Could not complete the AI connection." }));
                    }
                    return;
                }
            }

            // Delegate Room-Specific Messages
            if (ws.roomId && rooms.has(ws.roomId)) {
                await rooms.get(ws.roomId).handleMessage(ws, parsedMessage);
            } else {
                logger.warn(`[SERVER] Unrouted message type="${parsedMessage.type}" from client ${ws.id} (roomId=${ws.roomId})`);
                ws.send(JSON.stringify({ type: "error", message: "Not connected to a channel. Please rejoin." }));
            }

        } catch (error) {
            logger.error("Failed to handle message:", error);
        }
    });

    const releaseIpSlot = () => {
        if (!ws.ip) return;
        const count = ipSocketCount.get(ws.ip);
        if (!count || count <= 1) ipSocketCount.delete(ws.ip);
        else ipSocketCount.set(ws.ip, count - 1);
        ws.ip = null; // idempotent: don't double-decrement on close+error
    };

    ws.on("error", (err) => {
        logger.error(`[WS Error] Client ${ws.id}:`, err.message);
        clients.delete(ws);
        if (ws.roomId && rooms.has(ws.roomId)) {
            rooms.get(ws.roomId).removeClient(ws);
        }
        releaseIpSlot();
    });

    ws.on("close", (code, reason) => {
        const reasonStr = reason ? reason.toString() : '';
        logger.info(`Client disconnected (id: ${ws.id}, code: ${code}, reason: ${reasonStr || '[none]'})`);
        clients.delete(ws);
        if (ws.roomId && rooms.has(ws.roomId)) {
            rooms.get(ws.roomId).removeClient(ws);
        }
        releaseIpSlot();
    });
});

// Server-side WebSocket heartbeat: detect and terminate dead connections that
// never sent a clean close (e.g. network drop, OS killed the app).
const WS_HEARTBEAT_INTERVAL = 30000;
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            logger.info(`[Heartbeat] Terminating dead connection: ${ws.id}`);
            clients.delete(ws);
            if (ws.roomId && rooms.has(ws.roomId)) {
                rooms.get(ws.roomId).removeClient(ws);
            }
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, WS_HEARTBEAT_INTERVAL);

// Periodic sweep: remove clients that are no longer in OPEN state
setInterval(() => {
    let cleaned = 0;
    for (const ws of clients) {
        if (ws.readyState !== WebSocket.OPEN) {
            clients.delete(ws);
            if (ws.roomId && rooms.has(ws.roomId)) {
                rooms.get(ws.roomId).removeClient(ws);
            }
            cleaned++;
        }
    }
    if (cleaned > 0) logger.info(`[Sweep] Cleaned ${cleaned} stale client entries.`);
}, 60000);

// Cleanup Idle Rooms (Every 5 minutes)
setInterval(() => {
    logger.info("Running cleanup task...");
    for (const [id, room] of rooms.entries()) {
        if (room.clients.size === 0) {
            logger.info(`Unloading idle room: ${room.name} (${id})`);
            room.destroy(); // Stop the timer
            rooms.delete(id);
        }
    }
}, 5 * 60 * 1000);

// Cleanup Old Room History, expired sessions, and stale API caches (Once a day)
setInterval(() => {
    logger.info("Running daily cleanup task...");
    dbAsync.runDailyCleanup();
}, 24 * 60 * 60 * 1000);

// Run all cleanups once on startup as well
dbAsync.runDailyCleanup();

function gracefulShutdown(signal) {
    logger.info(`[Shutdown] ${signal} received. Closing ${wss.clients.size} connections...`);
    const shutdownMsg = JSON.stringify({ type: "error", code: "SERVER_RESTARTING", message: "Server is restarting. Reconnecting..." });
    wss.clients.forEach((ws) => {
        try {
            ws.send(shutdownMsg);
            ws.close(1012, 'Server restarting');
        } catch (e) { /* ignore */ }
    });
    for (const room of rooms.values()) {
        room.destroy();
    }
    rooms.clear();
    dbAsync.shutdown();
    wss.close(() => {
        server.close(() => {
            logger.info('[Shutdown] Server closed.');
            process.exit(0);
        });
    });
    setTimeout(() => process.exit(0), 3000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
