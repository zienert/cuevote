// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
const crypto = require("crypto");
const db = require("./db");
const dbAsync = require("./db-async");
const logger = require("./logger");
const schemas = require("./schemas");
const { sortUpcoming, AUTO_DJ } = require("./queue-order");
const guest = require("./guest");
const { appleTrackKey } = require("./track-keys");
const { bestMatch, isStorefront, parseAppleMusicLink } = require("./apple-catalog");

// Apple Music catalog for Apple rooms; index.js sets it when MusicKit is set up
// (Room.setAppleCatalog). Without it Apple rooms cannot resolve suggestions.
let appleCatalog = null;

// MusicKit errors that concern only the item being played. Every other error
// (sign-in, subscription, DRM, another device streaming, blocked autoplay) is a
// problem on the host's side that the next track would hit as well.
const APPLE_ITEM_ERRORS = new Set([
    'CONTENT_UNAVAILABLE',
    'CONTENT_RESTRICTED',
    'CONTENT_UNSUPPORTED',
    'NOT_FOUND',
    'GEO_BLOCK',
]);

// Helper to check ownership
function isOwner(room, ws) {
    if (!ws.user) return false;
    // Ownership is the room's owner_id and nothing else.
    // For now, strict owner check
    return room.metadata.owner_id === ws.user.id;
}

// Helper to parse ISO 8601 duration (PT1H2M10S) into seconds.
// Anchored regex so we don't accept "PT1H...garbage" or "garbagePT1H";
// non-capturing groups + an explicit '0' default replace the
// parseInt("1H") trick (which used to work, just confusingly).
function parseISO8601Duration(duration) {
    const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
    if (!match) return 0;
    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    const seconds = parseInt(match[3] || '0', 10);
    return hours * 3600 + minutes * 60 + seconds;
}

// Track fields that name a person: `voters` is a map keyed by account id (a
// Google subject, or a `guest:` id for someone who never signed in), and
// `suggestedBy` holds one. Neither has any use on the client — the display name
// travels separately as `suggestedByUsername`, and a viewer only needs to know
// its OWN vote, which is folded in as `myVote`.
//
// Broadcasting the raw map handed every room member a list of the Google account
// ids of everyone who had voted, next to their display names. JOIN_ROOM does not
// require a login, so that included clients that had never signed in. admin.js
// already strips exactly these two fields before the state leaves the process
// over localhost; the same is now true of the socket.
const TRACK_COLLECTIONS = ['queue', 'history', 'pendingSuggestions', 'bannedVideos'];

function projectTrack(track, viewerId) {
    if (!track || typeof track !== 'object') return track;
    const { voters, suggestedBy, ...rest } = track;
    const myVote = viewerId && voters ? voters[viewerId] : undefined;
    return myVote ? { ...rest, myVote } : rest;
}

// A copy of a state — or of a delta — with those fields removed and the viewer's
// own vote added. Only keys that are actually present get touched, so deltas
// pass through unchanged apart from the track collections they carry.
function projectState(state, viewerId) {
    if (!state || typeof state !== 'object') return state;
    const out = { ...state };
    if ('currentTrack' in out) out.currentTrack = projectTrack(out.currentTrack, viewerId);
    for (const key of TRACK_COLLECTIONS) {
        if (Array.isArray(out[key])) out[key] = out[key].map(t => projectTrack(t, viewerId));
    }
    return out;
}

function viewerIdOf(ws) {
    return (ws && ws.user && ws.user.id) || '';
}

// Fisher-Yates shuffle for unbiased randomization
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

class Room {
    constructor(id, name, apiKey, metadata = {}) {
        this.id = id;
        this.name = name;
        this.apiKey = apiKey;
        this.metadata = {
            description: metadata.description || "",
            color: metadata.color || "from-gray-700 to-black",
            owner_id: metadata.owner_id,
            is_public: metadata.is_public !== undefined ? metadata.is_public : 1,
            password: metadata.password || null,
            captions_enabled: metadata.captions_enabled !== undefined ? metadata.captions_enabled : 0,
            language_flag: metadata.language_flag || 'international',
            require_login: metadata.require_login !== undefined ? metadata.require_login : 0,
            // Fixed at creation: an Apple Music room never takes YouTube tracks.
            provider: metadata.provider === 'apple' ? 'apple' : 'youtube',
            // Country of the host's Apple account, reported by their player.
            apple_storefront: isStorefront(metadata.apple_storefront) ? metadata.apple_storefront : null
        };
        this.clients = new Set();
        this.knownVideos = new Set(); // Stores videoIds of approved videos
        this.ipBlockedVideos = new Map(); // videoId -> { failCount, lastFailedAt } for IP-blocked cooldown
        this.consecutiveIPErrors = 0;    // Consecutive confirmed IP-block events
        this.networkThrottleUntil = 0;   // Timestamp: suppress API calls and pause queue during throttle window
        this.videoStatusCache = new Map(); // videoId -> { reason, checkedAt } to avoid redundant API calls
        this.videoStatusChecksInFlight = new Set(); // videoIds mid-API-check; dedupes concurrent PLAYBACK_ERRORs
        this.isRehydrating = false;        // Guards the on-join metadata re-fetch from concurrent duplicate runs

        this.state = {
            roomId: id, // Send ID to client for validation
            queue: [],
            history: [],
            currentTrack: null,
            isPlaying: false,
            progress: 0,
            activeChannel: name,
            ownerId: metadata.owner_id,
            provider: this.metadata.provider,
            suggestionsEnabled: true,
            musicOnly: false, // Default false
            maxDuration: 600, // Default 10 minutes
            allowPrelisten: true,
            ownerBypass: true, // Bypass suggestions disabled
            ownerQueueBypass: false, // Bypass queue voting (Priority)
            votesEnabled: true, // Allow voting
            smartQueue: true, // Auto-replace bad videos if full
            ownerPopups: true, // Show popups for new requests
            playlistViewMode: false, // Venue Mode: Only show playlist view for guests
            maxQueueSize: 50, // Default 50
            suggestionMode: 'auto', // 'auto' or 'manual'
            pendingSuggestions: [],
            duplicateCooldown: 10, // Default 10 songs
            autoApproveKnown: true, // Default true
            autoRefill: metadata.auto_refill !== undefined ? !!metadata.auto_refill : true,
            captionsEnabled: !!(metadata.captions_enabled), // Initialize from metadata
            // Off by default: a guest who scanned the QR code can vote and
            // suggest straight away. Owners who want every participant tied to
            // an account can turn it on per room.
            requireLogin: !!(metadata.require_login),
            bannedVideos: [], // List of banned videos { videoId, title, artist, ... }
        };

        // Start the Room Timer
        this.interval = setInterval(() => this.tick(), 1000);

        this.stateSaveCounter = 0;
        this.stateSaveInterval = setInterval(() => {
            if (this.state.currentTrack || this.state.queue.length > 0) {
                dbAsync.saveRoomStateAndActivity(this.id, this.state);
            }
        }, 30000);

        // Periodic cleanup of in-memory caches (every 10 minutes)
        this.cacheCleanupInterval = setInterval(() => {
            const now = Date.now();
            // Evict expired ipBlockedVideos entries (30 min cooldown)
            for (const [id, entry] of this.ipBlockedVideos) {
                if (now - entry.lastFailedAt > 1800000) this.ipBlockedVideos.delete(id);
            }
            // Evict expired videoStatusCache entries (5 min TTL)
            for (const [id, entry] of this.videoStatusCache) {
                if (now - entry.checkedAt > 300000) this.videoStatusCache.delete(id);
            }
            // Cap knownVideos to prevent unbounded growth
            if (this.knownVideos.size > 5000) {
                const excess = this.knownVideos.size - 5000;
                const iter = this.knownVideos.values();
                for (let i = 0; i < excess; i++) {
                    this.knownVideos.delete(iter.next().value);
                }
            }
        }, 10 * 60 * 1000);

        // Load History from Database (Persistent Library)
        try {
            const savedHistory = db.getRoomHistory(this.id);
            if (savedHistory && savedHistory.length > 0) {
                this.state.history = savedHistory.slice(-200);
            }
        } catch (error) {
            logger.error(`[Room ${this.id}] Failed to load history from DB:`, error);
        }

        // Restore saved playback state (crash recovery / dormant resume)
        try {
            const saved = db.loadRoomState(this.id);
            if (saved) {
                if (saved.queue && saved.queue.length > 0) this.state.queue = saved.queue;
                if (saved.currentTrack) this.state.currentTrack = saved.currentTrack;
                if (saved.progress) this.state.progress = saved.progress;
                if (saved.isPlaying) this.state.isPlaying = saved.isPlaying;
                // Recalculate startedAt from saved progress so tick() doesn't
                // see a stale timestamp and immediately advance past the track
                if (this.state.currentTrack && this.state.progress > 0) {
                    this.state.currentTrack = {
                        ...this.state.currentTrack,
                        startedAt: Date.now() - (this.state.progress * 1000)
                    };
                }
                logger.info(`[Room ${this.id}] Restored saved state (queue: ${this.state.queue.length}, playing: ${this.state.isPlaying}, progress: ${this.state.progress})`);
            }
        } catch (error) {
            logger.error(`[Room ${this.id}] Failed to restore saved state:`, error);
        }

        // Clear stale lobby preview for long-dormant rooms (YouTube metadata
        // in the preview may be > 28 days old). Playback state is preserved
        // so the room resumes exactly where it left off.
        const TWENTY_EIGHT_DAYS_S = 28 * 24 * 60 * 60;
        if (metadata.last_active_at) {
            const dormantSeconds = Math.floor(Date.now() / 1000) - metadata.last_active_at;
            if (dormantSeconds > TWENTY_EIGHT_DAYS_S) {
                logger.info(`[Room ${this.id}] Dormant for ${Math.floor(dormantSeconds / 86400)} days. Clearing stale lobby preview.`);
                try { db.updateLobbyPreview(this.id, null); } catch (e) { /* ignore */ }
            }
        }
    }

    hasViewers() {
        return this.clients.size > 0;
    }

    /**
     * Whether this socket may vote or suggest, and why not when it may not.
     *
     * A socket always carries an identity by this point — a signed-in user or a
     * room-scoped guest — because a stable id is what keeps one participant from
     * voting the same track up repeatedly. `requireLogin` is the owner's choice
     * to narrow that to real accounts.
     */
    canParticipate(ws) {
        // Two different refusals, and they must not be conflated: one says the
        // owner requires accounts, the other says this socket has no identity
        // yet. Reporting the first for the second tells people to sign in to a
        // room that never asked them to.
        if (!ws.user) return { ok: false, code: "NO_IDENTITY", message: "Your session is not ready yet. Please reload the page." };
        if (this.state.requireLogin && ws.user.isGuest) {
            return { ok: false, code: "LOGIN_REQUIRED", message: "This channel requires a signed-in account." };
        }
        return { ok: true };
    }

    getSummary() {
        // No lobby preview for Apple rooms, see persistLobbyPreview().
        const track = this.metadata.provider === 'apple' ? null : this.state.currentTrack;
        return {
            id: this.id,
            name: this.name,
            description: this.metadata.description,
            color: this.metadata.color,
            listeners: this.clients.size,
            currentTrack: track ? {
                thumbnail: track.thumbnail,
                title: track.title,
                artist: track.artist,
            } : null,
            isActive: true,
            language_flag: this.metadata.language_flag,
            provider: this.metadata.provider
        };
    }

    addClient(ws) {
        if (this.deleted) {
            ws.send(JSON.stringify({ type: "error", message: "This channel has been deleted." }));
            ws.close();
            return;
        }
        logger.info(`[SERVER TRACE] Room ${this.id}: Adding client. Total clients: ${this.clients.size + 1}`);
        this.clients.add(ws);

        // Safety: if a room has no owner_id, do not silently assign ownership
        if (!this.metadata.owner_id && ws.user) {
            logger.warn(`[Room ${this.id}] Missing owner_id in metadata; treating as ownerless for this session.`);
            this.state.ownerId = null;
        }

        try {
            const payload = JSON.stringify({ type: "state", payload: projectState(this.state, viewerIdOf(ws)) });
            if (ws.readyState === 1) {
                ws.send(payload);
            }
        } catch (e) {
            logger.error(`ERROR sending state to client ${ws.id}:`, e);
        }

        // TV station: refill queue with API-validated content when a viewer joins an idle station
        if (this.state.autoRefill && !this.state.isRefilling
            && this.state.queue.length === 0 && this.state.history.length > 0) {
            this.populateQueueFromHistory();
        }

        // Heal the now-playing track + queue items whose cached title/artist were
        // cleared by the 28-day TOS cleanup, so this viewer sees real metadata
        // instead of loading skeletons. No-op (no API call) when nothing is missing.
        this.rehydrateVisibleMetadata().catch(err =>
            logger.error(`[Rehydrate] Room ${this.id} failed:`, err));
    }

    // Re-fetch metadata for the currently-playing track and any queued tracks
    // whose cached title was nulled by the 28-day cleanup. Keyed on "title is
    // missing", not age, so it reliably fills gaps and skips work otherwise.
    // Cheap: one batched YouTube call per 50 ids, and only the first viewer
    // after a dormant gap pays for it — once healed, later joins find nothing
    // missing and return immediately.
    async rehydrateVisibleMetadata() {
        if (this.isRehydrating) return;

        const ids = [];
        const seen = new Set();
        const collect = (track) => {
            if (track && track.videoId && !track.title && !seen.has(track.videoId)) {
                seen.add(track.videoId);
                ids.push(track.videoId);
            }
        };
        collect(this.state.currentTrack);
        for (const track of this.state.queue) collect(track);
        if (ids.length === 0) return;

        this.isRehydrating = true;
        try {
            // checkVideoAvailability returns Map<id, {title,artist,thumbnail,duration}|null>
            // and re-caches each hit via db.upsertVideo (refreshing fetched_at), so the
            // DB heals too. A null value means "couldn't verify" (no API key / quota /
            // error) — leave the track as a skeleton rather than guess.
            logger.info(`[Rehydrate] Room ${this.id}: ${ids.length} visible track(s) missing metadata — fetching from YouTube.`);
            const fresh = await this.checkVideoAvailability(ids);
            const resolved = ids.filter(id => fresh.get(id)).length;

            const apply = (track) => {
                if (!track || !track.videoId || track.title) return track;
                const meta = fresh.get(track.videoId);
                return meta ? { ...track, ...meta } : track;
            };

            // Drop upcoming-queue tracks the API CONFIRMED are gone — a successful
            // call omits deleted/private/non-embeddable ids entirely, so an id that's
            // still title-less AND absent from `fresh` is a dead skeleton that can
            // never fill. We deliberately keep:
            //   • present-but-null ids — "couldn't verify" (no key / quota / fetch
            //     error); checkVideoAvailability returns those present, so they stay
            //     as skeletons for a later retry. With no API key EVERY id comes back
            //     present-with-null, so nothing is dropped (no accidental queue wipe).
            //   • index 0 — it mirrors the now-playing currentTrack, and tick()/skip
            //     logic assumes queue[0] is current; removing it would desync playback.
            //     The playing copy is left in place too (PLAYBACK_ERROR handles that).
            const isConfirmedGone = (track) =>
                !!track && !!track.videoId && !track.title && !fresh.has(track.videoId);

            const newQueue = this.state.queue
                .filter((track, i) => i === 0 || !isConfirmedGone(track))
                .map(apply);
            const newCurrent = apply(this.state.currentTrack);

            const removed = this.state.queue.length - newQueue.length;
            const changed = newCurrent !== this.state.currentTrack
                || removed > 0
                || newQueue.some((track, i) => track !== this.state.queue[i]);
            if (changed) {
                this.updateState({ currentTrack: newCurrent, queue: newQueue });
            }
            if (removed > 0) {
                logger.info(`[Rehydrate] Room ${this.id}: dropped ${removed} confirmed-unavailable track(s) from the queue.`);
            }

            if (resolved < ids.length) {
                logger.warn(`[Rehydrate] Room ${this.id}: filled ${resolved}/${ids.length} — ${ids.length - resolved} unresolved (YOUTUBE_API_KEY missing/quota, or videos unavailable).`);
            } else {
                logger.info(`[Rehydrate] Room ${this.id}: filled ${resolved}/${ids.length} stale track(s).`);
            }
        } finally {
            this.isRehydrating = false;
        }
    }

    removeClient(ws) {
        this.clients.delete(ws);
    }

    // Send one socket the state as that viewer may see it. Used when ws.user
    // changes mid-session (login / resume) — the copy the client already holds
    // was projected for whoever it was at the time.
    sendStateTo(ws) {
        if (!ws || ws.readyState !== 1) return;
        try {
            ws.send(JSON.stringify({ type: "state", payload: projectState(this.state, viewerIdOf(ws)) }));
        } catch (e) {
            logger.error(`ERROR sending state to client ${ws.id}:`, e);
        }
    }

    // Serialize once per distinct viewer identity, not once per socket: every
    // guest shares one projection, and so do a user's several tabs.
    broadcastProjected(type, payload) {
        const byViewer = new Map();
        for (const client of this.clients) {
            if (client.readyState !== 1) continue;
            const viewerId = viewerIdOf(client);
            let message = byViewer.get(viewerId);
            if (message === undefined) {
                message = JSON.stringify({ type, payload: projectState(payload, viewerId) });
                byViewer.set(viewerId, message);
            }
            client.send(message);
        }
    }

    broadcastState() {
        this.broadcastProjected("state", this.state);
    }

    broadcast(message) {
        const payload = typeof message === 'string' ? message : JSON.stringify(message);
        for (const client of this.clients) {
            if (client.readyState === 1) { // OPEN
                client.send(payload);
            }
        }
    }

    updateState(newState) {
        const trackChanged = 'currentTrack' in newState
            && newState.currentTrack !== this.state.currentTrack;
        this.state = { ...this.state, ...newState };
        if (trackChanged) this.persistLobbyPreview();
        this.broadcastDelta(newState);
    }

    broadcastDelta(delta) {
        this.broadcastProjected("state_delta", delta);
    }

    persistLobbyPreview() {
        // Apple Music artwork and titles may only appear next to playback, so an
        // Apple room's lobby card never shows what is playing.
        const track = this.metadata.provider === 'apple' ? null : this.state.currentTrack;
        const newKey = track ? `${track.thumbnail}\0${track.title}\0${track.artist}` : '';
        if (newKey === this._lastLobbyPreviewKey) return;
        this._lastLobbyPreviewKey = newKey;
        try {
            db.updateLobbyPreview(this.id, track ? {
                thumbnail: track.thumbnail,
                title: track.title,
                artist: track.artist,
            } : null);
        } catch (e) {
            logger.error(`[Room ${this.id}] Failed to persist lobby preview:`, e);
        }
    }

    tick() {
        if (this.state.isPlaying && this.state.currentTrack) {
            // FIX: Timestamp Stability
            // If startedAt is missing (legacy track or server restart), back-fill it
            if (!this.state.currentTrack.startedAt) {
                // Assume current progress is correct relative to now
                this.state.currentTrack.startedAt = Date.now() - (this.state.progress * 1000);
            }

            // Calculate progress based on wall-clock time diff
            const elapsed = Math.floor((Date.now() - this.state.currentTrack.startedAt) / 1000);
            const newProgress = elapsed >= 0 ? elapsed : 0;
            const duration = this.state.currentTrack.duration || 200;

            if (newProgress >= duration) {
                // Auto-Advance
                const newQueue = [...this.state.queue];

                // Move current track to history if it exists
                let newHistory = [...this.state.history];
                if (this.state.currentTrack) {
                    const trackToSave = { ...this.state.currentTrack, playedAt: Date.now() };
                    newHistory.push(trackToSave);

                    // Persist history addition to Database (non-blocking worker thread)
                    dbAsync.addToRoomHistory(this.id, trackToSave);
                }

                // Cap memory history
                if (newHistory.length > 200) {
                    newHistory = newHistory.slice(-200);
                }

                newQueue.shift();
                const newCurrentTrack = newQueue[0] || null;

                // Initialize timestamp for new track
                if (newCurrentTrack) {
                    newCurrentTrack.startedAt = Date.now();
                }

                const newState = {
                    queue: newQueue,
                    history: newHistory,
                    currentTrack: newCurrentTrack,
                    progress: 0,
                };
                if (!newCurrentTrack) {
                    newState.isPlaying = false;

                    this.updateState(newState);

                    // Auto-Refill Logic
                    if (!newCurrentTrack && this.state.autoRefill && this.state.history.length > 0) {
                        if (!this.state.isRefilling) {
                            this.populateQueueFromHistory();
                        }
                    }
                } else {
                    this.updateState(newState);
                }
            } else {
                if (newProgress !== this.state.progress) {
                    this.state.progress = newProgress;
                    if (!this._lastProgressBroadcast || (Date.now() - this._lastProgressBroadcast >= 5000)) {
                        this._lastProgressBroadcast = Date.now();
                        this.broadcast({ type: "progress", payload: newProgress });
                    }
                }
            }

            // Suggestion Check Trigger is now REMOVED to save API Quota (Option 4).
            // Suggestions are now only fetched explicitly via the FETCH_SUGGESTIONS message triggered by the client.
        }
    }

    async populateQueueFromHistory() {
        if (this.state.isRefilling) {
            logger.info(`[AutoRefill] Already refilling, skip.`);
            return;
        }
        logger.info(`[AutoRefill] Triggered for Room ${this.id}`);
        this.updateState({ isRefilling: true });

        try {
            const {
                history,
                maxQueueSize,
                maxDuration,
                duplicateCooldown,
                musicOnly
            } = this.state;

            // 1. Target Size: Half of maxQueueSize (def 50 -> 25), or total history if less
            if (history.length < 1) {
                logger.info(`[AutoRefill] No history. Abort.`);
                this.updateState({ isRefilling: false });
                return;
            }

            // User: "Fill the playlist with half of its queue size."
            const targetFillSize = Math.floor((maxQueueSize > 0 ? maxQueueSize : 50) / 2); // Default to 25 if unlimited
            let needed = targetFillSize;

            // 2. Filter Candidates (Repetition, Duration)

            // Deduplicate history for the candidate pool to avoid frequency bias
            const uniqueHistoryMap = new Map();
            history.forEach(track => uniqueHistoryMap.set(track.videoId, track));
            const uniqueHistory = Array.from(uniqueHistoryMap.values());

            // Check if we have enough unique history?
            // If unique history is small, we might just re-add same songs?
            // "If there is less than half of the queue size in history, add the total amount of songs"

            const shuffledHistory = shuffleArray([...uniqueHistory]);

            const candidates = [];

            const historyTitles = (duplicateCooldown > 0)
                ? history.slice(-duplicateCooldown)
                    .filter(t => t.title)
                    .map(t => t.title.toLowerCase().trim())
                : [];
            const videoIdsToCheck = [];

            // Perform strict duplicate check against CURRENT QUEUE + Recent History
            const queueVideoIds = new Set(this.state.queue.map(t => t.videoId));

            for (const track of shuffledHistory) {
                if (candidates.length >= needed) break;

                if (!track.videoId) continue;

                // Duration Check (skip if known; null duration passes through for API re-fetch)
                if (maxDuration > 0 && track.duration && track.duration > maxDuration) continue;

                // Music-only filter (skip if known; null category passes through for API re-fetch)
                if (musicOnly && track.category_id && track.category_id !== '10') continue;

                // IP Cooldown Check — skip videos that recently failed due to IP blocks (30 min cooldown)
                const ipEntry = this.ipBlockedVideos.get(track.videoId);
                if (ipEntry && (Date.now() - ipEntry.lastFailedAt) < 1800000) continue;

                // Repetition Check (History cooldown) — skip if title unknown (cleared metadata)
                const title = track.title ? track.title.toLowerCase().trim() : null;
                if (title && historyTitles.includes(title)) continue;

                // Check if video is ALREADY IN QUEUE (prevent immediate duplicate)
                if (queueVideoIds.has(track.videoId)) continue;

                // Check if we already picked this title in current candidates
                if (title && candidates.some(c => c.title && c.title.toLowerCase().trim() === title)) continue;

                candidates.push(track);
                videoIdsToCheck.push(track.videoId);
            }

            // Fallback: when library is very small, relax duplicate/cooldown checks to allow looping
            if (candidates.length === 0 && uniqueHistory.length > 0) {
                logger.info(`[AutoRefill] No candidates after strict filtering. Relaxing checks for small library (${uniqueHistory.length} unique videos).`);
                for (const track of shuffledHistory) {
                    if (candidates.length >= needed) break;
                    if (!track.videoId) continue;
                    if (maxDuration > 0 && track.duration && track.duration > maxDuration) continue;
                    const ipEntry = this.ipBlockedVideos.get(track.videoId);
                    if (ipEntry && (Date.now() - ipEntry.lastFailedAt) < 1800000) continue;
                    candidates.push(track);
                    videoIdsToCheck.push(track.videoId);
                }
            }

            if (candidates.length === 0) {
                logger.info("[AutoRefill] No valid candidates found after filtering.");
                this.updateState({ isRefilling: false });
                return;
            }

            // 3. Check Video Availability
            // Skip API validation when no viewers to save quota. Note: the 28-day
            // cleanup only NULLs the videos table (rows/IDs persist), so candidates
            // here may carry null title/artist. That's fine — when no one is watching
            // we don't re-fetch, and the next viewer's rehydrateVisibleMetadata() fills
            // the gaps on join. Full API validation also runs here when viewers are present.
            const validVideos = this.hasViewers()
                ? await this.checkVideoAvailability(videoIdsToCheck)
                : new Map(videoIdsToCheck.map(id => [id, null]));

            const finalTracks = [];
            const invalidVideoIds = new Set();

            for (const track of candidates) {
                if (validVideos.has(track.videoId)) {
                    const fresh = validVideos.get(track.videoId);
                    finalTracks.push({
                        ...track,
                        ...(fresh || {}),
                        id: crypto.randomUUID(),
                        score: 0,
                        voters: {},
                        suggestedBy: AUTO_DJ,
                        suggestedByUsername: 'Channel Mix'
                    });
                } else {
                    invalidVideoIds.add(track.videoId);
                }
            }

            // Remove invalid videos from history entirely (use current state so we don't drop entries added during async work)
            if (invalidVideoIds.size > 0) {
                const cleanedHistory = this.state.history.filter(t => !invalidVideoIds.has(t.videoId));
                this.updateState({ history: cleanedHistory });
                logger.info(`[AutoRefill] Removed ${invalidVideoIds.size} invalid videos from history.`);
            }

            if (finalTracks.length > 0) {
                // User: "Make sure that half of the queue size get succesfully added."
                // We tried our best.

                // Add to Queue
                const newQueue = [...this.state.queue, ...finalTracks];

                // tick() stops playback whenever the queue runs dry, and this
                // refill is async — so by now it has likely already stopped.
                // Setting isPlaying below is what starts it again.
                const newState = {
                    queue: newQueue,
                    isRefilling: false
                };

                if (!this.state.isPlaying && newQueue.length > 0) {
                    newState.currentTrack = { ...newQueue[0], startedAt: Date.now() };
                    newQueue[0] = newState.currentTrack;
                    newState.queue = newQueue;
                    newState.isPlaying = true;
                    newState.progress = 0;
                }

                this.updateState(newState);
                logger.info(`[AutoRefill] Added ${finalTracks.length} videos to queue.`);

            } else {
                this.updateState({ isRefilling: false });
            }

        } catch (err) {
            logger.error("[AutoRefill] Error:", err);
            this.updateState({ isRefilling: false });
        }
    }

    setAppleStorefront(storefront) {
        if (this.metadata.apple_storefront === storefront) return;
        this.metadata.apple_storefront = storefront;
        try {
            db.updateRoomAppleStorefront(this.id, storefront);
        } catch (e) {
            logger.error(`[Room ${this.id}] Failed to store the Apple storefront: ${e && e.message}`);
        }
        logger.info(`[Room ${this.id}] Apple Music storefront: ${storefront}`);
    }

    // Same contract as checkVideoAvailability, for Apple keys: a key maps to
    // fresh metadata, to null when it could not be checked (no catalog, no
    // storefront yet, Apple unreachable), and is absent when Apple confirmed it
    // cannot be played in the host's country.
    async checkAppleAvailability(keys) {
        const storefront = this.metadata.apple_storefront;
        const unchecked = () => new Map(keys.map(key => [key, null]));
        if (!appleCatalog || !storefront || keys.length === 0) return unchecked();
        let found;
        try {
            found = await appleCatalog.lookup(storefront, keys);
        } catch (e) {
            logger.error(`[Room ${this.id}] Apple Music lookup failed: ${e && e.code} ${e && e.message}`);
            return unchecked();
        }
        const result = new Map();
        for (const key of keys) {
            const track = found.get(key);
            if (!track) continue;
            const meta = { title: track.title, artist: track.artist, thumbnail: track.thumbnail, duration: track.duration };
            result.set(key, meta);
            try {
                db.upsertVideo({ id: key, ...meta, category_id: null, language: null });
            } catch (e) { /* ignore cache refresh errors */ }
        }
        return result;
    }

    async checkVideoAvailability(videoIds) {
        if (this.metadata.provider === 'apple') return this.checkAppleAvailability(videoIds);
        if (!this.apiKey || videoIds.length === 0) return new Map(videoIds.map(id => [id, null]));

        const validVideos = new Map();

        const chunkSize = 50;
        for (let i = 0; i < videoIds.length; i += chunkSize) {
            const chunk = videoIds.slice(i, i + chunkSize);
            try {
                const apiUrl = `https://www.googleapis.com/youtube/v3/videos?id=${chunk.join(',')}&part=status,snippet,contentDetails&key=${this.apiKey}`;
                const response = await fetch(apiUrl);

                if (!response.ok) {
                    const errorBody = await response.text().catch(() => '');
                    logger.error(`[AutoRefill] API returned HTTP ${response.status}: ${errorBody.slice(0, 200)}`);
                    for (const id of chunk) validVideos.set(id, null);
                    continue;
                }

                const data = await response.json();

                if (data.items) {
                    for (const item of data.items) {
                        const status = item.status;
                        if (status) {
                            if (status.privacyStatus === 'private') continue;
                            if (status.uploadStatus === 'rejected') continue;
                            if (status.embeddable === false) continue;

                            const snippet = item.snippet;
                            const freshData = snippet ? {
                                thumbnail: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url,
                                title: snippet.title,
                                artist: snippet.channelTitle,
                                duration: item.contentDetails ? parseISO8601Duration(item.contentDetails.duration) : null,
                            } : null;

                            validVideos.set(item.id, freshData);

                            if (snippet) {
                                try {
                                    db.upsertVideo({
                                        id: item.id,
                                        title: snippet.title,
                                        artist: snippet.channelTitle,
                                        thumbnail: freshData.thumbnail,
                                        duration: item.contentDetails ? parseISO8601Duration(item.contentDetails.duration) : null,
                                        category_id: snippet.categoryId || null,
                                        language: snippet.defaultAudioLanguage || snippet.defaultLanguage || null,
                                    });
                                } catch (e) { /* ignore cache refresh errors */ }
                            }
                        }
                    }
                    // IDs not returned by the API are genuinely deleted/private — leave them out of validVideos
                }
            } catch (e) {
                logger.error("[AutoRefill] API Check Failed:", e);
                for (const id of chunk) validVideos.set(id, null);
            }
        }
        return validVideos;
    }

    async handleMessage(ws, message) {
        const sendAck = () => {
            if (message.msgId && ws.readyState === 1) {
                ws.send(JSON.stringify({ type: "ACK", msgId: message.msgId }));
            }
        };

        switch (message.type) {
            case "SUGGEST_SONG": {
                const r = schemas.SuggestSongPayload.safeParse(message.payload);
                if (!r.success) { ws.send(JSON.stringify({ type: "error", message: "Invalid suggestion." })); break; }
                await this.handleSuggestSong(ws, r.data);
                sendAck();
                break;
            }
            case "VOTE": {
                const r = schemas.VotePayload.safeParse(message.payload);
                if (!r.success) { ws.send(JSON.stringify({ type: "error", message: "Invalid vote." })); break; }
                this.handleVote(ws, r.data);
                sendAck();
                break;
            }
            case "PLAY_PAUSE": {
                const r = schemas.PlayPausePayload.safeParse(message.payload);
                if (!r.success) break;
                if (isOwner(this, ws)) {
                    if (r.data === true) {
                        this.networkThrottleUntil = 0;
                        this.consecutiveIPErrors = 0;
                    }
                    this.updateState({ isPlaying: r.data });
                }
                break;
            }
            case "NEXT_TRACK":
                if (isOwner(this, ws)) {
                    this.handleNextTrack();
                }
                break;
            case "PLAYBACK_ERROR": {
                const r = schemas.PlaybackErrorPayload.safeParse(message.payload);
                if (!r.success) break;
                if (isOwner(this, ws)) {
                    await this.handlePlaybackError(ws, r.data);
                }
                break;
            }
            case "APPLE_STOREFRONT": {
                // The host's MusicKit reports the country of their Apple account.
                // Suggestions are looked up there, where the host can play them.
                if (this.metadata.provider !== 'apple' || !isOwner(this, ws)) break;
                if (!isStorefront(message.payload)) break;
                this.setAppleStorefront(message.payload);
                break;
            }
            case "UPDATE_DURATION": {
                const r = schemas.UpdateDurationPayload.safeParse(message.payload);
                if (!r.success) break;
                if (isOwner(this, ws) && this.state.currentTrack) {
                    this.consecutiveIPErrors = 0;
                    this.networkThrottleUntil = 0;
                    this.updateState({
                        currentTrack: { ...this.state.currentTrack, duration: r.data },
                    });
                }
                break;
            }
            case "SEEK_TO": {
                const r = schemas.SeekToPayload.safeParse(message.payload);
                if (!r.success) break;
                if (isOwner(this, ws) && this.state.currentTrack) {
                    const duration = this.state.currentTrack.duration || 0;
                    const clamped = duration > 0 ? Math.min(r.data, duration) : r.data;
                    this.state.currentTrack = { ...this.state.currentTrack, startedAt: Date.now() - (clamped * 1000) };
                    this.updateState({ progress: clamped });
                }
                break;
            }
            case "UPDATE_SETTINGS": {
                const r = schemas.UpdateSettingsPayload.safeParse(message.payload);
                if (!r.success) break;
                if (isOwner(this, ws)) {
                    this.handleUpdateSettings(r.data);
                }
                break;
            }
            case "APPROVE_SUGGESTION": {
                const r = schemas.TrackIdPayload.safeParse(message.payload);
                if (!r.success) break;
                if (isOwner(this, ws)) this.handleApproveSuggestion(r.data);
                break;
            }
            case "REJECT_SUGGESTION": {
                const r = schemas.TrackIdPayload.safeParse(message.payload);
                if (!r.success) break;
                if (isOwner(this, ws)) this.handleRejectSuggestion(r.data);
                break;
            }
            case "DELETE_SONG": {
                const r = schemas.TrackIdPayload.safeParse(message.payload);
                if (!r.success) break;
                if (isOwner(this, ws)) this.handleDeleteSong(r.data);
                break;
            }
            case "BAN_SUGGESTION": {
                const r = schemas.TrackIdPayload.safeParse(message.payload);
                if (!r.success) break;
                if (isOwner(this, ws)) this.handleBanSuggestion(r.data);
                break;
            }
            case "UNBAN_SONG": {
                const r = schemas.VideoIdPayload.safeParse(message.payload);
                if (!r.success) break;
                if (isOwner(this, ws)) this.handleUnbanSong(r.data);
                break;
            }
            case "REMOVE_FROM_LIBRARY": {
                const r = schemas.VideoIdPayload.safeParse(message.payload);
                if (!r.success) break;
                if (isOwner(this, ws)) this.handleRemoveFromLibrary(r.data);
                break;
            }
            case "DELETE_ROOM":
                if (isOwner(this, ws)) {
                    this.handleDeleteRoom(ws);
                } else {
                    ws.send(JSON.stringify({ type: "error", message: "Unauthorized to delete room. Are you the owner?" }));
                }
                break;
            case "DELETE_ACCOUNT":
                // Unreachable: index.js answers DELETE_ACCOUNT in its own switch
                // and returns, so it never reaches a room. Kept as an explicit
                // no-op so the case is not mistaken for an oversight.
                break;
            case "FETCH_SUGGESTIONS": {
                const r = schemas.FetchSuggestionsPayload.safeParse(message.payload);
                if (!r.success) break;
                this.handleFetchSuggestions(ws, r.data);
                break;
            }
        }
    }

    // Look a video up among the tracks this room actually holds. Used to keep
    // FETCH_SUGGESTIONS from being a free-form YouTube search.
    findRoomTrack(videoId) {
        const pools = [
            this.state.currentTrack ? [this.state.currentTrack] : [],
            this.state.queue,
            this.state.history,
            this.state.pendingSuggestions,
        ];
        for (const pool of pools) {
            const hit = Array.isArray(pool) && pool.find(t => t && t.videoId === videoId);
            if (hit) return hit;
        }
        return null;
    }

    async handleFetchSuggestions(ws, { videoId }) {
        if (!videoId) return;
        // "More from this artist" is a YouTube search; Apple rooms do not offer it.
        if (this.metadata.provider === 'apple') return;

        // The most expensive call in the room: a cache miss is a Search at ~100
        // of the 10.000 daily quota units. Suggesting and voting were opened to
        // guests deliberately; this was not, and `!ws.user` stopped meaning
        // "signed in" the moment guests got an identity.
        if (!guest.hasAccount(ws)) {
            ws.send(JSON.stringify({ type: "error", code: "ACCOUNT_REQUIRED", message: "You must be logged in to fetch suggestions." }));
            return;
        }

        // Title and artist come from the server, never from the payload. The
        // client used to supply both the cache key AND the search term, which
        // let anyone write an arbitrary result list under a popular track's id —
        // platform-wide, for the 30 days the cache lives, and from there into
        // real queues via autoRefill. Resolving against the room's own tracks
        // (falling back to the videos table for one that just rotated out) pins
        // the search to metadata we already hold for that exact id.
        const known = this.findRoomTrack(videoId) || db.getVideo(videoId);
        if (!known) {
            ws.send(JSON.stringify({ type: "error", message: "Unknown video." }));
            return;
        }
        const { title, artist } = known;

        try {
            // 1. Check Cache
            const cached = db.getRelatedVideos(videoId);
            if (cached) {
                const age = Math.floor(Date.now() / 1000) - cached.fetched_at;
                if (age < 2592000) {
                    ws.send(JSON.stringify({ type: "SUGGESTION_RESULT", payload: { sourceVideoId: videoId, suggestions: cached.data } }));
                    return;
                }
            }

            if (!this.apiKey) {
                ws.send(JSON.stringify({ type: "error", message: "Suggestions unavailable (No API Key)." }));
                return;
            }

            // 2. Fetch from API (Search by keyword)
            // Strategy: Search for the ARTIST to get "More from this artist".
            //Searching for "Title + Artist" mostly returns covers/versions of the same video.
            let query = "";
            if (artist && artist.toLowerCase() !== "unknown artist") {
                query = artist; // Best for variety (other videos by same artist)
            } else {
                query = title; // Fallback
            }

            const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&videoCategoryId=10&maxResults=6&key=${this.apiKey}`;
            logger.info("[Suggestions] Fetching Search for query:", encodeURIComponent(query));

            const response = await fetch(apiUrl, {
                headers: { 'Referer': process.env.URL || 'https://cuevote.com' }
            });
            const data = await response.json();
            logger.info("[Suggestions] YouTube Response: items:", data.items?.length ?? 0);

            if (data.items) {
                const suggestions = data.items
                    .filter(item => item.id.videoId !== videoId) // Exclude self
                    .map(item => ({
                        videoId: item.id.videoId,
                        title: item.snippet.title,
                        artist: item.snippet.channelTitle,
                        thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.default?.url
                    }));

                // Save to Cache
                db.saveRelatedVideos(videoId, suggestions);

                // Send to Client
                ws.send(JSON.stringify({ type: "SUGGESTION_RESULT", payload: { sourceVideoId: videoId, suggestions } }));
            } else {
                logger.error("[Suggestions] No items found in response (pageInfo: %j)", data?.pageInfo);
                ws.send(JSON.stringify({ type: "error", message: "No suggestions found." }));
            }
        } catch (e) {
            logger.error("Manual Fetch Error:", e);
            ws.send(JSON.stringify({ type: "error", message: "Failed to fetch suggestions." }));
        }
    }

    async handleSuggestSong(ws, payload) {
        const access = this.canParticipate(ws);
        if (!access.ok) {
            ws.send(JSON.stringify({ type: "error", code: access.code, message: access.message }));
            return;
        }

        const isUserOwner = isOwner(this, ws);
        const canBypass = isUserOwner && this.state.ownerBypass;

        if (!this.state.suggestionsEnabled && !canBypass) {
            ws.send(JSON.stringify({ type: "error", message: "Suggestions are currently disabled by the room owner." }));
            return;
        }

        const { query } = payload; // Moved up for title check

        // The duplicate check compares titles, not video ids, so the same song
        // re-uploaded under a different id still counts as a repeat. It cannot
        // run here: the title only exists once the video has been resolved, so
        // it happens after that step and before anything joins the queue.

        // A low-scored track to drop when the queue is full. Kept by id, not by
        // index: the lookup below awaits, and the queue can move meanwhile.
        let trackToReplaceId = null;

        // Check Max Queue Size
        if (this.state.maxQueueSize > 0 && !canBypass && this.state.queue.length >= this.state.maxQueueSize) {
            // Smart Replacement: Look for worst video (score < 0) to replace ONLY IF ENABLED
            if (this.state.smartQueue) {
                // Skip index 0 (current track)
                const upcomingQueue = this.state.queue.slice(1);
                let worstTrackIndex = -1;
                let minScore = 0; // Must be strictly less than 0 to be considered

                upcomingQueue.forEach((track, index) => {
                    const score = track.score || 0;
                    if (score < 0) {
                        if (worstTrackIndex === -1 || score < minScore) {
                            minScore = score;
                            worstTrackIndex = index + 1; // Adjust for slice offset
                        }
                    }
                });

                if (worstTrackIndex !== -1) {
                    // Found a bad video to replace, mark it for removal later
                    trackToReplaceId = this.state.queue[worstTrackIndex].id;
                } else {
                    ws.send(JSON.stringify({ type: "error", message: `Queue is full. Max size is ${this.state.maxQueueSize}.` }));
                    return;
                }
            } else {
                ws.send(JSON.stringify({ type: "error", message: `Queue is full. Max size is ${this.state.maxQueueSize}.` }));
                return;
            }
        }

        // Rate Limiting (5 seconds) - Bypass for owner
        const now = Date.now();
        if (!canBypass && ws.lastSuggestionTime && (now - ws.lastSuggestionTime < 5000)) {
            ws.send(JSON.stringify({ type: "error", message: "Please wait before suggesting another video." }));
            return;
        }
        ws.lastSuggestionTime = now;

        // Apple Music rooms resolve suggestions in Apple's catalog, never on YouTube.
        if (this.metadata.provider === 'apple') {
            const appleTrack = await this.resolveAppleSuggestion(ws, query, canBypass);
            if (appleTrack) this.queueSuggestion(ws, appleTrack, { canBypass, isUserOwner, trackToReplaceId });
            return;
        }

        // const { query } = payload; // Already destructured above
        const userId = ws.user.id; // Trust server-side user object
        let videoId = null;

        // 1. Resolve Video ID (URL or Search)
        const urlMatch = query.match(/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/);

        if (urlMatch) {
            videoId = urlMatch[1];
        } else {
            // Check Search Cache
            const cachedSearchId = db.getSearchTermVideo(query);
            if (cachedSearchId) {
                logger.info(`[Search Cache] Hit for "${query}" -> ${cachedSearchId}`);
                videoId = cachedSearchId;
            } else if (this.apiKey) {
                // Search via API
                try {
                    // Fetch up to 5 results to find a non-livestream
                    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=5&key=${this.apiKey}`;
                    const searchRes = await fetch(searchUrl, {
                        headers: {
                            'Referer': process.env.URL || 'https://cuevote.com'
                        }
                    });
                    const searchData = await searchRes.json();

                    if (searchData.items && searchData.items.length > 0) {
                        // Find first non-livestream
                        const validVideo = searchData.items.find(item => item.snippet && item.snippet.liveBroadcastContent === 'none');

                        if (validVideo) {
                            videoId = validVideo.id.videoId;
                        } else {
                            videoId = searchData.items[0].id.videoId;
                        }

                        // Cache the result
                        if (videoId) {
                            db.cacheSearchTerm(query, videoId);
                        }
                    }
                } catch (err) {
                    logger.error("Search failed:", err);
                }
            }
        }

        if (!videoId) {
            ws.send(JSON.stringify({ type: "error", message: "Could not find video." }));
            return;
        }

        // 2. Fetch Details & Validate
        let track = null;

        // Check if banned before anything else
        if (this.state.bannedVideos.some(b => b.videoId === videoId)) {
            ws.send(JSON.stringify({ type: "error", message: "This video has been banned from this channel." }));
            return;
        }

        // Check Video DB Cache
        let cachedVideo = db.getVideo(videoId);
        if (cachedVideo) {
            const nowSeconds = Math.floor(Date.now() / 1000);
            // 28 Days = 2419200 seconds
            if (nowSeconds - cachedVideo.fetched_at > 2419200) {
                logger.info(`[Video Cache] Stale for ${videoId}. Refetching.`);
                cachedVideo = null;
            }
        }

        if (cachedVideo) {
            logger.info(`[Video Cache] Hit for ${videoId} (Fresh)`);

            // Validate Cached Data against Room Rules
            // Max Duration
            if (this.state.maxDuration > 0 && !canBypass && cachedVideo.duration > this.state.maxDuration) {
                const maxMinutes = Math.floor(this.state.maxDuration / 60);
                ws.send(JSON.stringify({ type: "error", message: `Video is too long. Max duration is ${maxMinutes} minutes.` }));
                return;
            }
            // Music Only
            if (this.state.musicOnly && cachedVideo.category_id !== '10') {
                ws.send(JSON.stringify({ type: "error", message: "Only music videos are allowed in this channel." }));
                return;
            }

            track = {
                id: crypto.randomUUID(),
                videoId: cachedVideo.id,
                title: cachedVideo.title,
                artist: cachedVideo.artist,
                thumbnail: cachedVideo.thumbnail,
                duration: cachedVideo.duration,
                score: 0,
                voters: {},
                suggestedBy: userId,
                suggestedByUsername: ws.user.name,
                suggestedByIsGuest: !!ws.user.isGuest,
                suggestedByGuestTag: ws.user.guestTag,
                language: cachedVideo.language // Restore language from cache
            };

        } else if (this.apiKey) {
            try {
                const apiUrl = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=contentDetails,snippet,status&key=${this.apiKey}`;
                const response = await fetch(apiUrl, {
                    headers: {
                        'Referer': process.env.URL || 'https://cuevote.com'
                    }
                });
                const data = await response.json();

                if (data.items && data.items.length > 0) {
                    const videoData = data.items[0];

                    // Check Embeddable Status
                    if (videoData.status && videoData.status.embeddable === false) {
                        ws.send(JSON.stringify({ type: "error", message: "This video playback is restricted by the owner (Not Embeddable)." }));
                        return;
                    }

                    // Check Age Restriction
                    if (videoData.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted') {
                        ws.send(JSON.stringify({ type: "error", message: "Age-restricted videos are not allowed." }));
                        return;
                    }

                    const broadcastContent = videoData.snippet.liveBroadcastContent;
                    if (broadcastContent === 'live') {
                        ws.send(JSON.stringify({ type: "error", message: "Livestreams are not allowed." }));
                        return;
                    }

                    const durationInSeconds = parseISO8601Duration(videoData.contentDetails.duration);
                    if (durationInSeconds === 0 && broadcastContent !== 'none') {
                        ws.send(JSON.stringify({ type: "error", message: "Livestreams are not allowed." }));
                        return;
                    }

                    // Max Duration Check
                    if (this.state.maxDuration > 0 && !canBypass && durationInSeconds > this.state.maxDuration) {
                        const maxMinutes = Math.floor(this.state.maxDuration / 60);
                        ws.send(JSON.stringify({ type: "error", message: `Video is too long. Max duration is ${maxMinutes} minutes.` }));
                        return;
                    }

                    // Music Only Check
                    if (this.state.musicOnly) {
                        const categoryId = videoData.snippet.categoryId;
                        if (categoryId !== '10') { // 10 is Music
                            ws.send(JSON.stringify({ type: "error", message: "Only music videos are allowed in this channel." }));
                            return;
                        }
                    }

                    track = {
                        id: crypto.randomUUID(),
                        videoId: videoId,
                        title: videoData.snippet.title,
                        artist: videoData.snippet.channelTitle,
                        thumbnail: videoData.snippet.thumbnails.high?.url || videoData.snippet.thumbnails.default?.url,
                        duration: durationInSeconds,
                        score: 0,
                        voters: {},
                        suggestedBy: userId,
                        suggestedByUsername: ws.user.name,
                        suggestedByIsGuest: !!ws.user.isGuest,
                        suggestedByGuestTag: ws.user.guestTag,
                        language: videoData.snippet.defaultAudioLanguage || videoData.snippet.defaultLanguage
                    };

                    // Cache to DB
                    db.upsertVideo({
                        id: videoId,
                        title: track.title,
                        artist: track.artist,
                        thumbnail: track.thumbnail,
                        duration: track.duration,
                        category_id: videoData.snippet.categoryId,
                        language: track.language
                    });
                } else {
                    logger.info(`[DEBUG API] Video Details Response Missing Items. Status: ${response.status}. Error: ${data.error?.message || 'no items'}.`);
                }
            } catch (apiError) {
                logger.error("YouTube API Check failed:", apiError);
            }
        }

        // A video id that resolved to no metadata: no API key, a quota refusal,
        // or a video that is gone. Reject rather than queue something unverified.
        if (!track) {
            ws.send(JSON.stringify({ type: "error", message: "Server could not verify video details." }));
            return;
        }

        this.queueSuggestion(ws, track, { canBypass, isUserOwner, trackToReplaceId });
    }

    // Finds what a suggestion in an Apple Music room means: a music.apple.com
    // link, or a search in the host's country that prefers the original music
    // video (bestMatch). Sends the error itself and returns null when there is
    // nothing to queue.
    async resolveAppleSuggestion(ws, query, canBypass) {
        const fail = (message, code) => {
            ws.send(JSON.stringify(code ? { type: "error", code, message } : { type: "error", message }));
            return null;
        };
        const storefront = this.metadata.apple_storefront;
        if (!appleCatalog) return fail("Apple Music is not available on this server.", "APPLE_MUSIC_UNAVAILABLE");
        if (!storefront) return fail("The host has to connect Apple Music first.", "APPLE_MUSIC_NOT_CONNECTED");
        const isBanned = (key) => this.state.bannedVideos.some(b => b.videoId === key);

        let found = null;
        try {
            const link = parseAppleMusicLink(query);
            if (link) {
                const key = appleTrackKey(link.kind, link.id);
                if (isBanned(key)) return fail("This video has been banned from this channel.");
                found = (await appleCatalog.lookup(storefront, [key])).get(key) || null;
                if (!found) return fail("This title is not available on Apple Music in the host's country.", "APPLE_MUSIC_NOT_IN_STOREFRONT");
            } else if (/(?:youtube\.com|youtu\.be)\//i.test(query)) {
                return fail("This channel plays Apple Music. Paste a music.apple.com link or search by name.", "APPLE_MUSIC_ROOM");
            } else {
                // Ten of each: the original is often not among Apple's first few.
                found = bestMatch(query, await appleCatalog.search(storefront, query, { limit: 10 }));
                if (!found) return fail("Could not find this on Apple Music.", "APPLE_MUSIC_NOT_FOUND");
            }
        } catch (e) {
            logger.error(`[Room ${this.id}] Apple Music catalog: ${e && e.code} ${e && e.message}`);
            return fail("Apple Music did not answer. Please try again.", "APPLE_MUSIC_CATALOG_ERROR");
        }

        if (isBanned(found.videoId)) return fail("This video has been banned from this channel.");
        if (this.state.maxDuration > 0 && !canBypass && found.duration > this.state.maxDuration) {
            const maxMinutes = Math.floor(this.state.maxDuration / 60);
            return fail(`Video is too long. Max duration is ${maxMinutes} minutes.`);
        }

        return {
            id: crypto.randomUUID(),
            videoId: found.videoId,
            title: found.title,
            artist: found.artist,
            thumbnail: found.thumbnail,
            duration: found.duration,
            score: 0,
            voters: {},
            suggestedBy: ws.user.id,
            suggestedByUsername: ws.user.name,
            suggestedByIsGuest: !!ws.user.isGuest,
            suggestedByGuestTag: ws.user.guestTag,
        };
    }

    // What every suggestion goes through once it is resolved, whatever the
    // provider: the duplicate check, smart replacement, manual review, the queue.
    queueSuggestion(ws, track, { canBypass, isUserOwner, trackToReplaceId }) {
        // Duplicate Title Check (After we have track details)
        if (track.title && this.state.duplicateCooldown > 0 && !canBypass) {
            const cooldown = this.state.duplicateCooldown;
            const titleToCheck = track.title.toLowerCase().trim();

            // Check Queue + recent History. Skip entries whose title was cleared by
            // the 28-day metadata cleanup (null) — t.title.toLowerCase() would throw.
            const queueTitles = this.state.queue
                .filter(t => t.title)
                .map(t => t.title.toLowerCase().trim());
            const historyToCheck = this.state.history.slice(-cooldown)
                .filter(t => t.title)
                .map(t => t.title.toLowerCase().trim());

            // Logic: Check combined list of recent history + current queue
            const combinedList = [...historyToCheck, ...queueTitles];
            const recentTracks = combinedList.slice(-cooldown);

            const isDuplicate = recentTracks.some(t => t === titleToCheck);

            if (isDuplicate) {
                ws.send(JSON.stringify({ type: "error", message: `This video was recently played (Limit: ${cooldown}).` }));
                return;
            }
        }

        // Apply Smart Replacement if needed. Never index 0, the track playing now.
        if (trackToReplaceId) {
            const replaceIndex = this.state.queue.findIndex((t, i) => i > 0 && t.id === trackToReplaceId);
            if (replaceIndex > 0) {
                this.state.queue.splice(replaceIndex, 1);
            }
        }

        // Manual Review Check
        if (this.state.suggestionMode === 'manual' && !canBypass) {
            // Check if video is known and auto-approve is enabled
            const isKnown = this.knownVideos.has(track.videoId);
            if (this.state.autoApproveKnown && isKnown) {
                // Auto-approve: Skip adding to pending, proceed to queue
                logger.info(`[Auto-Approve] Video ${track.title} (${track.videoId}) is known. Bypassing review.`);
                // Fallthrough to add to queue and send success at the end
            } else {
                const newPending = [...(this.state.pendingSuggestions || []), track];
                this.updateState({ pendingSuggestions: newPending });
                ws.send(JSON.stringify({ type: "info", message: "Submitted" }));
                return;
            }
        }

        // Priority Check
        if (this.state.ownerQueueBypass && isUserOwner) {
            track.isOwnerPriority = true;
        }

        const newQueue = [...this.state.queue, track];
        const newState = { queue: newQueue };
        if (newQueue.length === 1) {
            newState.currentTrack = { ...newQueue[0], startedAt: Date.now() };
            newQueue[0] = newState.currentTrack;
            newState.isPlaying = true;
            newState.progress = 0;
        } else {
            // Re-order: the track just added may be a priority pick.
            newState.queue = sortUpcoming(newQueue);
        }
        this.updateState(newState);

        // Send Success Message (For all successful queue additions: Owner Bypass, Auto-Approve, or Auto-Mode)
        ws.send(JSON.stringify({ type: "success", message: "Added" }));
    }

    handleVote(ws, { trackId, voteType }) {
        const access = this.canParticipate(ws);
        if (!access.ok) {
            ws.send(JSON.stringify({ type: "error", code: access.code, message: access.message }));
            return;
        }

        const isUserOwner = isOwner(this, ws);
        const canBypass = isUserOwner && this.state.ownerBypass;

        if (!this.state.votesEnabled && !canBypass) {
            ws.send(JSON.stringify({ type: "error", message: "Voting is currently disabled." }));
            return;
        }

        const queue = [...this.state.queue];
        const trackIndex = queue.findIndex((t) => t.id === trackId);

        if (trackIndex !== -1) {
            const track = { ...queue[trackIndex] };
            const userId = ws.user.id;
            const previousVote = track.voters[userId];

            let scoreChange = 0;
            if (previousVote === voteType) {
                // Toggle off
                scoreChange = voteType === 'up' ? -1 : 1;
                delete track.voters[userId];
            } else {
                // Change vote or new vote
                if (voteType === 'up') {
                    scoreChange = previousVote === 'down' ? 2 : 1;
                } else {
                    scoreChange = previousVote === 'up' ? -2 : -1;
                }
                track.voters[userId] = voteType;
            }

            track.score = (track.score || 0) + scoreChange;
            queue[trackIndex] = track;

            this.updateState({ queue: sortUpcoming(queue) });
        }
    }

    // saveToHistory: false for a track that never played (an Apple item the
    // host's storefront does not offer): history feeds the library and Auto-DJ.
    handleNextTrack({ saveToHistory = true } = {}) {
        const newQueue = [...this.state.queue];

        // Move current track to history
        let newHistory = [...this.state.history];
        if (this.state.currentTrack && saveToHistory) {
            const trackToSave = { ...this.state.currentTrack, playedAt: Date.now() };
            newHistory.push(trackToSave);

            dbAsync.addToRoomHistory(this.id, trackToSave);
        }

        // Cap memory history
        if (newHistory.length > 200) {
            newHistory = newHistory.slice(-200);
        }

        newQueue.shift();
        const newCurrentTrack = newQueue[0] || null;

        if (newCurrentTrack) {
            newCurrentTrack.startedAt = Date.now(); // Init Timestamp
        }

        const newState = {
            queue: newQueue,
            history: newHistory,
            currentTrack: newCurrentTrack,
            progress: 0,
            isPlaying: true,
        };
        if (!newCurrentTrack) {
            newState.isPlaying = false;
            this.updateState(newState);

            if (this.state.autoRefill && this.state.history.length > 0 && !this.state.isRefilling) {
                this.populateQueueFromHistory();
            }
        } else {
            this.updateState(newState);
        }
    }

    // Apple playback fails on the host's side far more often than per item:
    // sign-in, subscription, DRM, another device streaming on the account. The
    // next track would fail the same way, so the room pauses and tells the host,
    // and skips only when this one item cannot be played.
    handleApplePlaybackError({ videoId, errorCode }) {
        if (!this.state.currentTrack || this.state.currentTrack.videoId !== videoId) return;
        const code = typeof errorCode === 'string' && errorCode ? errorCode : 'UNKNOWN_ERROR';
        if (APPLE_ITEM_ERRORS.has(code)) {
            logger.info(`[PlaybackError] Apple item ${videoId} cannot be played (${code}). Skipping.`);
            this.broadcast({ type: "VIDEO_STATUS", payload: { videoId, status: 'unavailable', title: this.state.currentTrack.title || null } });
            // It never played here: keep it out of history and the library, or
            // the Auto-DJ queues it straight back (13.11.2026).
            const history = this.state.history.filter(t => t.videoId !== videoId);
            if (history.length !== this.state.history.length) this.updateState({ history });
            this.handleNextTrack({ saveToHistory: false });
            return;
        }
        logger.warn(`[PlaybackError] Apple playback stopped on the host's side (${code}). Pausing.`);
        this.updateState({ isPlaying: false });
        for (const client of this.clients) {
            if (isOwner(this, client) && client.readyState === 1) {
                client.send(JSON.stringify({ type: "APPLE_PLAYBACK_PROBLEM", payload: { code } }));
            }
        }
    }

    async handlePlaybackError(ws, { videoId, errorCode }) {
        if (this.metadata.provider === 'apple') {
            this.handleApplePlaybackError({ videoId, errorCode });
            return;
        }
        if (!videoId || !this.state.currentTrack || this.state.currentTrack.videoId !== videoId) return;

        const now = Date.now();
        const THROTTLE_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours — IP blocks typically last hours, not minutes
        const CACHE_TTL_MS = 5 * 60 * 1000;            // Re-check same video after 5 min

        let isGenuinelyUnavailable = true;
        let reason = 'unavailable';

        // If the network is already in throttle mode, skip the API call entirely and pause.
        if (now < this.networkThrottleUntil) {
            logger.info(`[PlaybackError] Network throttle active. Pausing playback instead of skipping.`);
            this.updateState({ isPlaying: false });
            this.broadcast({ type: "NETWORK_THROTTLE", payload: { until: this.networkThrottleUntil } });
            return;
        }

        // Check per-video cache to avoid burning quota for the same video
        const cached = this.videoStatusCache.get(videoId);
        if (cached && (now - cached.checkedAt) < CACHE_TTL_MS) {
            reason = cached.reason;
            isGenuinelyUnavailable = (reason !== 'ip_blocked' && reason !== 'check_failed' && reason !== 'no_api_key');
            logger.info(`[PlaybackError] Using cached status for ${videoId}: ${reason}`);
        } else if (this.apiKey) {
            // The cache above is only written after the fetch resolves, so a
            // second PLAYBACK_ERROR for the same video arriving mid-check
            // passes the entry guard again and would skip twice.
            if (this.videoStatusChecksInFlight.has(videoId)) return;
            this.videoStatusChecksInFlight.add(videoId);
            try {
                const apiUrl = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=status,contentDetails&key=${this.apiKey}`;
                const response = await fetch(apiUrl);
                const data = await response.json();

                if (!response.ok || data.error) {
                    logger.error("[PlaybackError] YouTube API returned error:", data.error?.message || `HTTP ${response.status}`);
                    isGenuinelyUnavailable = false;
                    reason = 'check_failed';
                } else if (data.items && data.items.length > 0) {
                    const status = data.items[0].status;
                    if (status) {
                        if (status.privacyStatus === 'private') {
                            reason = 'private';
                        } else if (status.uploadStatus === 'rejected') {
                            reason = 'rejected';
                        } else if (status.embeddable === false) {
                            reason = 'not_embeddable';
                        } else {
                            isGenuinelyUnavailable = false;
                            reason = 'ip_blocked';
                        }
                    }
                    // If items exists but status is fine, video is playable from server's IP → IP block
                } else {
                    // No items: video deleted or private (not returned by API)
                    reason = 'unavailable';
                }
            } catch (e) {
                logger.error("[PlaybackError] API check failed:", e);
                isGenuinelyUnavailable = false;
                reason = 'check_failed';
            } finally {
                this.videoStatusChecksInFlight.delete(videoId);
            }
            this.videoStatusCache.set(videoId, { reason, checkedAt: now });
        } else {
            isGenuinelyUnavailable = false;
            reason = 'no_api_key';
        }

        // Re-validate after the awaits above: tick() or a manual skip may have
        // advanced the queue during the API check — acting on the stale error
        // now would skip a track that never failed.
        if (!this.state.currentTrack || this.state.currentTrack.videoId !== videoId) return;

        // The title travels along: by the time clients show the notice, the
        // next track may already be current.
        this.broadcast({ type: "VIDEO_STATUS", payload: { videoId, status: reason, title: this.state.currentTrack.title || null } });

        if (isGenuinelyUnavailable) {
            logger.info(`[PlaybackError] Video ${videoId} genuinely unavailable (${reason}). Skipping with history.`);
            this.consecutiveIPErrors = 0;
            this.handleNextTrack();
        } else {
            logger.info(`[PlaybackError] Video ${videoId} likely IP-blocked (${reason}). Consecutive: ${this.consecutiveIPErrors + 1}`);
            this.ipBlockedVideos.set(videoId, {
                failCount: (this.ipBlockedVideos.get(videoId)?.failCount || 0) + 1,
                lastFailedAt: now
            });
            this.consecutiveIPErrors += 1;

            // Any confirmed IP block: stop immediately and warn. IP blocks are all-or-nothing —
            // every subsequent video on the same network will also fail.
            this.networkThrottleUntil = now + THROTTLE_WINDOW_MS;
            logger.warn(`[PlaybackError] IP block confirmed. Entering network throttle mode (6h). Consecutive: ${this.consecutiveIPErrors}`);
            this.updateState({ isPlaying: false });
            this.broadcast({ type: "NETWORK_THROTTLE", payload: { until: this.networkThrottleUntil } });
        }
    }

    handleUpdateSettings({ suggestionsEnabled, musicOnly, maxDuration, allowPrelisten, ownerBypass, maxQueueSize, smartQueue, playlistViewMode, suggestionMode, ownerPopups, duplicateCooldown, ownerQueueBypass, votesEnabled, autoApproveKnown, autoRefill, captionsEnabled, requireLogin }) {
        const updates = {};
        if (typeof suggestionsEnabled === 'boolean') updates.suggestionsEnabled = suggestionsEnabled;
        if (typeof musicOnly === 'boolean') updates.musicOnly = musicOnly;
        if (typeof maxDuration === 'number') updates.maxDuration = maxDuration;
        if (typeof allowPrelisten === 'boolean') updates.allowPrelisten = allowPrelisten;
        if (typeof ownerBypass === 'boolean') updates.ownerBypass = ownerBypass;
        if (typeof smartQueue === 'boolean') updates.smartQueue = smartQueue;
        if (typeof playlistViewMode === 'boolean') updates.playlistViewMode = playlistViewMode;
        if (typeof maxQueueSize === 'number') updates.maxQueueSize = maxQueueSize;
        if (typeof ownerPopups === 'boolean') updates.ownerPopups = ownerPopups;
        if (suggestionMode === 'auto' || suggestionMode === 'manual') updates.suggestionMode = suggestionMode;
        if (typeof duplicateCooldown === 'number') updates.duplicateCooldown = duplicateCooldown;
        if (typeof ownerQueueBypass === 'boolean') updates.ownerQueueBypass = ownerQueueBypass;
        if (typeof votesEnabled === 'boolean') updates.votesEnabled = votesEnabled;
        if (typeof autoApproveKnown === 'boolean') updates.autoApproveKnown = autoApproveKnown;
        if (typeof autoRefill === 'boolean') updates.autoRefill = autoRefill;
        if (typeof captionsEnabled === 'boolean') updates.captionsEnabled = captionsEnabled;
        if (typeof requireLogin === 'boolean') updates.requireLogin = requireLogin;

        if (Object.keys(updates).length > 0) {
            this.updateState(updates);

            // Persist DB Settings (captions_enabled)
            if (updates.captionsEnabled !== undefined) {
                this.metadata.captions_enabled = updates.captionsEnabled ? 1 : 0; // Update memory metadata
                try {
                    db.updateRoomSettings(this.id, { captions_enabled: updates.captionsEnabled });
                } catch (e) { logger.error("Failed to persist room settings", e); }
            }

            // Persist requireLogin to DB — a room's access rule has to survive
            // a restart, or a party silently reopens to guests mid-evening.
            if (updates.requireLogin !== undefined) {
                this.metadata.require_login = updates.requireLogin ? 1 : 0;
                try {
                    db.updateRoomSettings(this.id, { require_login: updates.requireLogin });
                } catch (e) { logger.error("Failed to persist require_login", e); }
            }

            // Persist autoRefill to DB
            if (updates.autoRefill !== undefined) {
                try {
                    db.updateRoomSettings(this.id, { auto_refill: updates.autoRefill });
                } catch (e) { logger.error("Failed to persist auto_refill", e); }
            }

            // Trigger Auto-Refill if enabled and queue is empty
            if (updates.autoRefill === true && this.state.queue.length === 0
                && this.state.history.length >= 1 && !this.state.isRefilling) {
                this.populateQueueFromHistory();
            }
        }
    }

    handleApproveSuggestion({ trackId }) {
        const pending = this.state.pendingSuggestions || [];
        const index = pending.findIndex(t => t.id === trackId);
        if (index !== -1) {
            const track = pending[index];
            const newPending = [...pending];
            newPending.splice(index, 1);

            const newQueue = [...this.state.queue, track];
            this.knownVideos.add(track.videoId);
            const newState = {
                pendingSuggestions: newPending
            };

            if (newQueue.length === 1 && !this.state.isPlaying) {
                newState.currentTrack = { ...newQueue[0], startedAt: Date.now() };
                newQueue[0] = newState.currentTrack;
                newState.queue = newQueue;
                newState.isPlaying = true;
                newState.progress = 0;
            } else {
                newState.queue = sortUpcoming(newQueue);
            }

            this.updateState(newState);
        }
    }

    handleRejectSuggestion({ trackId }) {
        const pending = this.state.pendingSuggestions || [];
        const index = pending.findIndex(t => t.id === trackId);
        if (index !== -1) {
            const newPending = [...pending];
            newPending.splice(index, 1);
            this.updateState({ pendingSuggestions: newPending });
        }
    }

    handleBanSuggestion({ trackId }) {
        const pending = this.state.pendingSuggestions || [];
        const index = pending.findIndex(t => t.id === trackId);

        if (index !== -1) {
            const track = pending[index];
            const newPending = [...pending];
            newPending.splice(index, 1);

            // Add to banned list
            if (!this.state.bannedVideos.some(b => b.videoId === track.videoId)) {
                const newBanned = [
                    ...this.state.bannedVideos,
                    {
                        videoId: track.videoId,
                        title: track.title,
                        artist: track.artist,
                        thumbnail: track.thumbnail,
                        bannedAt: Date.now()
                    }
                ];
                this.updateState({
                    pendingSuggestions: newPending,
                    bannedVideos: newBanned
                });
            } else {
                this.updateState({ pendingSuggestions: newPending });
            }
        }
    }

    handleUnbanSong({ videoId }) {
        const banned = this.state.bannedVideos || [];
        const newBanned = banned.filter(t => t.videoId !== videoId);
        this.updateState({ bannedVideos: newBanned });
    }

    handleRemoveFromLibrary({ videoId }) {
        if (!videoId) return;
        const initialCount = this.state.history.length;
        // Filter out all instances of this videoId
        const newHistory = this.state.history.filter(t => t.videoId !== videoId);

        // Also remove from knownSongs cache
        if (this.knownVideos.has(videoId)) {
            this.knownVideos.delete(videoId);
        }

        if (newHistory.length !== initialCount) {
            logger.info(`[Room ${this.id}] Removed video ${videoId} from history.`);
            this.updateState({ history: newHistory });

            // Delete from persistent database as well
            try {
                db.removeFromRoomHistory(this.id, videoId);
            } catch (err) {
                logger.error(`[Room ${this.id}] Failed to remove track from DB history:`, err);
            }
        }
    }

    handleDeleteSong({ trackId }) {
        const queue = this.state.queue;
        const index = queue.findIndex(t => t.id === trackId);

        if (index !== -1) {
            const newQueue = [...queue];
            newQueue.splice(index, 1);

            if (index === 0) {
                // Preserve deleted current track in history for Auto-DJ pool
                let newHistory = [...this.state.history];
                if (this.state.currentTrack) {
                    const trackToSave = { ...this.state.currentTrack, playedAt: Date.now() };
                    newHistory.push(trackToSave);
                    dbAsync.addToRoomHistory(this.id, trackToSave);
                }
                if (newHistory.length > 200) {
                    newHistory = newHistory.slice(-200);
                }

                const newState = {
                    queue: newQueue,
                    history: newHistory,
                    progress: 0
                };
                if (newQueue.length > 0) {
                    newState.currentTrack = { ...newQueue[0], startedAt: Date.now() };
                    newQueue[0] = newState.currentTrack;
                    newState.queue = newQueue;
                    newState.isPlaying = true;
                } else {
                    newState.currentTrack = null;
                    newState.isPlaying = false;
                    this.updateState(newState);

                    if (this.state.autoRefill && this.state.history.length > 0 && !this.state.isRefilling) {
                        this.populateQueueFromHistory();
                    }
                    return;
                }
                this.updateState(newState);
            } else {
                this.updateState({ queue: newQueue });
            }
        }
    }

    handleDeleteRoom(ws) {
        logger.info(`[Room ${this.id}] DELETING ROOM initiated by owner.`);
        ws.send(JSON.stringify({ type: "info", message: "Processing deletion..." }));
        try {
            const result = db.deleteRoom(this.id);
            logger.info(`[Delete Room] DB rows affected: ${result.changes}`);

            if (result.changes > 0) {
                this.deleted = true;
                ws.send(JSON.stringify({ type: "success", message: `Channel deleted. Goodbye!` }));
                this.broadcast(JSON.stringify({ type: "ROOM_DELETED" }));

                // Force close connections
                setTimeout(() => {
                    this.clients.forEach(c => {
                        try { c.close(); } catch (e) { }
                    });
                    this.clients.clear();
                }, 500);
            } else {
                ws.send(JSON.stringify({ type: "error", message: "Database deletion returned 0 changes. Room ID mismatch?" }));
            }
        } catch (err) {
            logger.error("Delete room failed", err);
            ws.send(JSON.stringify({ type: "error", message: "Failed to delete room." }));
        }
    }

    /**
     * GDPR: Remove a deleted user's PII from this room's in-memory state.
     * Call this for every active room when a user account is deleted so their
     * id/name are not broadcast in voters or suggestedBy/suggestedByUsername.
     */
    /**
     * Re-key one identity's votes and attributions onto another.
     *
     * Called when a socket signs in: the person keeps their guest votes instead
     * of the queue forgetting them. Without this the guest id stays in
     * `voters` while the new account id is absent, so the client shows the
     * track as unvoted and the same human can vote on it a second time.
     *
     * If the account has already voted on a track (from another device), the
     * guest's vote is removed and its contribution taken back out of the score,
     * so one person is counted once.
     *
     * `toName` is the account's display name. A re-attributed suggestion takes
     * it over; otherwise the track kept showing "Guest AB12" in English after
     * the guest marker that lets clients translate that label was gone.
     */
    mergeIdentity(fromId, toId, toName) {
        if (!fromId || !toId || fromId === toId) return false;

        let changed = false;

        // Returns a re-keyed copy, or the original when this track knows nothing
        // about `fromId` — so untouched collections keep their identity.
        const rekey = (track) => {
            if (!track || typeof track !== 'object') return track;
            let updated = track;

            const voters = track.voters;
            if (voters && voters[fromId] !== undefined) {
                const carried = voters[fromId];
                const nextVoters = { ...voters };
                delete nextVoters[fromId];

                let score = updated.score || 0;
                if (nextVoters[toId] !== undefined) {
                    // Already counted under the account (another device) — drop
                    // the duplicate and take its contribution back out.
                    score -= carried === 'up' ? 1 : -1;
                } else {
                    nextVoters[toId] = carried;
                }
                updated = { ...updated, voters: nextVoters, score };
            }

            if (updated.suggestedBy === fromId) {
                const { suggestedByGuestTag: _tag, ...rest } = updated;
                updated = { ...rest, suggestedBy: toId, suggestedByIsGuest: false };
                if (toName) updated.suggestedByUsername = toName;
            }

            return updated;
        };

        for (const key of TRACK_COLLECTIONS) {
            const collection = this.state[key];
            if (!Array.isArray(collection)) continue;

            let collectionChanged = false;
            const next = collection.map((track) => {
                const updated = rekey(track);
                if (updated !== track) collectionChanged = true;
                return updated;
            });

            if (collectionChanged) {
                this.state[key] = next;
                changed = true;
            }
        }

        // currentTrack is a separate object from queue[0], so it has to be
        // re-keyed on its own or the now-playing row keeps the stale identity.
        const nextCurrent = rekey(this.state.currentTrack);
        if (nextCurrent !== this.state.currentTrack) {
            this.state.currentTrack = nextCurrent;
            changed = true;
        }

        if (changed) {
            this.state.queue = sortUpcoming(this.state.queue);
            this.broadcastState();
        }
        return changed;
    }

    scrubDeletedUser(userId) {
        const id = String(userId).trim();
        const scrubTrack = (track) => {
            if (!track) return track;
            const next = { ...track };
            if (next.voters && next.voters[id] !== undefined) {
                const { [id]: _, ...rest } = next.voters;
                next.voters = rest;
            }
            if (next.suggestedBy === id) {
                next.suggestedBy = null;
                next.suggestedByUsername = '[deleted]';
            }
            return next;
        };

        const newQueue = (this.state.queue || []).map(scrubTrack);
        const newHistory = (this.state.history || []).map(scrubTrack);
        const newPending = (this.state.pendingSuggestions || []).map(scrubTrack);
        const newCurrentTrack = this.state.currentTrack ? scrubTrack(this.state.currentTrack) : null;

        this.state = {
            ...this.state,
            queue: newQueue,
            history: newHistory,
            pendingSuggestions: newPending,
            currentTrack: newCurrentTrack
        };
        this.broadcastState();
    }

    destroy() {
        clearInterval(this.interval);
        clearInterval(this.stateSaveInterval);
        clearInterval(this.cacheCleanupInterval);
        try { db.saveRoomState(this.id, this.state); } catch (e) { /* ignore */ }
    }
}

// index.js hands over the Apple Music catalog when MusicKit is configured.
Room.setAppleCatalog = (catalog) => { appleCatalog = catalog || null; };

module.exports = Room;
