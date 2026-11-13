// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
const Database = require('better-sqlite3');
const logger = require('./logger');
const { stripStateMetadata, scrubUserFromState } = require('./cleanup-helpers');
const db = new Database('cuevote.db'); // Creates the file if missing

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Wait up to 5s for write locks instead of failing immediately with SQLITE_BUSY
db.pragma('busy_timeout = 5000');

// Enforce Foreign Key constraints for cascading deletions
db.pragma('foreign_keys = ON');

// Initialize Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, -- Google 'sub' ID
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    picture TEXT,
    role TEXT DEFAULT 'user', -- 'admin', 'mod', 'user'
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    owner_id TEXT NOT NULL,
    is_public INTEGER DEFAULT 1,
    password TEXT, -- Optional password
    last_active_at INTEGER DEFAULT (unixepoch()),
    created_at INTEGER DEFAULT (unixepoch()),
    color TEXT DEFAULT 'from-gray-700 to-black',
    captions_enabled INTEGER DEFAULT 0,
    FOREIGN KEY(owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    title TEXT,
    artist TEXT,
    thumbnail TEXT,
    duration INTEGER,
    category_id TEXT,
    language TEXT,
    fetched_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS search_cache (
    term TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY(video_id) REFERENCES videos(id)
  );

  CREATE TABLE IF NOT EXISTS related_videos_cache (
    source_video_id TEXT PRIMARY KEY,
    data TEXT, -- JSON Array of video objects
    fetched_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS room_history (
    room_id TEXT NOT NULL,
    video_id TEXT NOT NULL,
    played_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (room_id, video_id),
    FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY(video_id) REFERENCES videos(id)
  );
`);

// Room state persistence for crash recovery
db.exec(`
  CREATE TABLE IF NOT EXISTS room_state (
    room_id TEXT PRIMARY KEY,
    state_json TEXT NOT NULL,
    saved_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );
`);

// Migration: Add captions_enabled if missing
try {
  db.prepare("ALTER TABLE rooms ADD COLUMN captions_enabled INTEGER DEFAULT 0").run();
} catch (e) {
  // Ignore duplicate column error
}

// Migration: Add language if missing
try {
  db.prepare("ALTER TABLE videos ADD COLUMN language TEXT").run();
} catch (e) {
  // Ignore duplicate column error
}

// Migration: Add auto_refill if missing (default ON for TV station mode)
try {
  db.prepare("ALTER TABLE rooms ADD COLUMN auto_refill INTEGER DEFAULT 1").run();
} catch (e) {
  // Ignore duplicate column error
}

// Migration: Add language_flag if missing (default 'international')
try {
  db.prepare("ALTER TABLE rooms ADD COLUMN language_flag TEXT DEFAULT 'international'").run();
} catch (e) {
  // Ignore duplicate column error
}

// Migration: Add lobby_preview for persistent thumbnails when rooms are unloaded
try {
  db.prepare("ALTER TABLE rooms ADD COLUMN lobby_preview TEXT DEFAULT NULL").run();
} catch (e) {
  // Ignore duplicate column error
}

// Indexes for common query patterns (IF NOT EXISTS makes these idempotent)
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_rooms_owner_last_active ON rooms(owner_id, last_active_at DESC);
  CREATE INDEX IF NOT EXISTS idx_rooms_public_last_active ON rooms(is_public, last_active_at DESC);
  CREATE INDEX IF NOT EXISTS idx_videos_fetched_at ON videos(fetched_at);
  CREATE INDEX IF NOT EXISTS idx_search_cache_created_at ON search_cache(created_at);
  CREATE INDEX IF NOT EXISTS idx_related_videos_fetched_at ON related_videos_cache(fetched_at);
`);

// Run versioned migrations (new migrations go in migrations/ directory)
const { runMigrations } = require('./migrator');
runMigrations(db);

module.exports = {
  getUser: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),
  getUserByEmail: (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(email),
  upsertUser: (user) => {
    const stmt = db.prepare(`
      INSERT INTO users (id, email, name, picture)
      VALUES (@id, @email, @name, @picture)
      ON CONFLICT(id) DO UPDATE SET
        name = @name,
        picture = @picture
    `);
    stmt.run(user);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  },
  createSession: (token, userId, expiresAt) => {
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  },
  getSession: (token) => {
    return db.prepare(`
        SELECT s.*, u.name, u.email, u.picture, u.role 
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token = ? AND s.expires_at > ?
    `).get(token, Math.floor(Date.now() / 1000));
  },
  deleteSession: (token) => {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  },

  // Atomic login: upsert user + create session in one transaction
  loginUser: (user, sessionToken, expiresAt) => {
    const transaction = db.transaction(() => {
      module.exports.upsertUser(user);
      module.exports.createSession(sessionToken, user.id, expiresAt);
    });
    transaction();
    return db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  },

  // Room Management
  createRoom: (room) => {
    const stmt = db.prepare(`
        INSERT INTO rooms (id, name, description, owner_id, color, is_public, password, captions_enabled, language_flag, provider)
        VALUES (@id, @name, @description, @owner_id, @color, @is_public, @password, @captions_enabled, @language_flag, @provider)
    `);
    if (room.captions_enabled === undefined) room.captions_enabled = 0;
    if (room.language_flag === undefined) room.language_flag = 'international';
    if (room.provider === undefined) room.provider = 'youtube';

    stmt.run(room);
    return db.prepare('SELECT * FROM rooms WHERE id = ?').get(room.id);
  },
  deleteRoom: (id) => db.prepare('DELETE FROM rooms WHERE id = ?').run(id),
  getRoom: (id) => db.prepare('SELECT * FROM rooms WHERE id = ?').get(id),
  listPublicRooms: (limit = 50, offset = 0) => {
    const activeDays = parseInt(process.env.ACTIVE_CHANNEL_DAYS || '60', 10);
    const threshold = Math.floor(Date.now() / 1000) - (activeDays * 24 * 60 * 60);
    return db.prepare('SELECT * FROM rooms WHERE is_public = 1 AND last_active_at > ? ORDER BY last_active_at DESC LIMIT ? OFFSET ?').all(threshold, limit, offset);
  },
  listPrivateRooms: (limit = 50, offset = 0) => {
    const activeDays = parseInt(process.env.ACTIVE_CHANNEL_DAYS || '60', 10);
    const threshold = Math.floor(Date.now() / 1000) - (activeDays * 24 * 60 * 60);
    return db.prepare('SELECT * FROM rooms WHERE is_public = 0 AND last_active_at > ? ORDER BY last_active_at DESC LIMIT ? OFFSET ?').all(threshold, limit, offset);
  },
  listUserRooms: (userId, limit = 50, offset = 0) => {
    return db.prepare('SELECT * FROM rooms WHERE owner_id = ? ORDER BY last_active_at DESC LIMIT ? OFFSET ?').all(userId, limit, offset);
  },
  countPublicRooms: () => {
    const activeDays = parseInt(process.env.ACTIVE_CHANNEL_DAYS || '60', 10);
    const threshold = Math.floor(Date.now() / 1000) - (activeDays * 24 * 60 * 60);
    return db.prepare('SELECT COUNT(*) as count FROM rooms WHERE is_public = 1 AND last_active_at > ?').get(threshold).count;
  },
  countPrivateRooms: () => {
    const activeDays = parseInt(process.env.ACTIVE_CHANNEL_DAYS || '60', 10);
    const threshold = Math.floor(Date.now() / 1000) - (activeDays * 24 * 60 * 60);
    return db.prepare('SELECT COUNT(*) as count FROM rooms WHERE is_public = 0 AND last_active_at > ?').get(threshold).count;
  },
  countUserRooms: (userId) => {
    return db.prepare('SELECT COUNT(*) as count FROM rooms WHERE owner_id = ?').get(userId).count;
  },
  updateRoomActivity: (id) => {
    db.prepare('UPDATE rooms SET last_active_at = unixepoch() WHERE id = ?').run(id);
  },
  updateLobbyPreview: (roomId, preview) => {
    const json = preview ? JSON.stringify(preview) : null;
    db.prepare('UPDATE rooms SET lobby_preview = ? WHERE id = ?').run(json, roomId);
  },
  updateRoomSettings: (id, settings) => {
    const updates = [];
    const values = [];

    if (settings.captions_enabled !== undefined) {
      updates.push("captions_enabled = ?");
      values.push(settings.captions_enabled ? 1 : 0);
    }

    if (settings.auto_refill !== undefined) {
      updates.push("auto_refill = ?");
      values.push(settings.auto_refill ? 1 : 0);
    }

    if (settings.language_flag !== undefined) {
      updates.push("language_flag = ?");
      values.push(settings.language_flag);
    }

    if (settings.require_login !== undefined) {
      updates.push("require_login = ?");
      values.push(settings.require_login ? 1 : 0);
    }

    if (updates.length > 0) {
      values.push(id);
      db.prepare(`UPDATE rooms SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }
  },

  // Server config (key/value, migration 009). Used for values that must be
  // stable across restarts but are not deployment configuration — see guest.js.
  getConfig: (key) => {
    const row = db.prepare('SELECT value FROM server_config WHERE key = ?').get(key);
    return row ? row.value : null;
  },

  // Insert-if-absent, so two processes racing on first start cannot end up with
  // different values: the loser's insert is ignored and it reads the winner's.
  setConfigIfAbsent: (key, value) => {
    db.prepare('INSERT OR IGNORE INTO server_config (key, value) VALUES (?, ?)').run(key, value);
    return module.exports.getConfig(key);
  },

  // Video Caching
  upsertVideo: (video) => {
    const stmt = db.prepare(`
      INSERT INTO videos (id, title, artist, thumbnail, duration, category_id, language, fetched_at)
      VALUES (@id, @title, @artist, @thumbnail, @duration, @category_id, @language, unixepoch())
      ON CONFLICT(id) DO UPDATE SET
        title = @title,
        artist = @artist,
        thumbnail = @thumbnail,
        duration = @duration,
        category_id = @category_id,
        language = @language,
        fetched_at = unixepoch()
    `);
    stmt.run(video);
  },
  getVideo: (id) => {
    return db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
  },
  cacheSearchTerm: (term, videoId) => {
    const stmt = db.prepare(`
      INSERT INTO search_cache (term, video_id, created_at)
      VALUES (?, ?, unixepoch())
      ON CONFLICT(term) DO UPDATE SET
        video_id = excluded.video_id,
        created_at = unixepoch()
    `);
    try {
      stmt.run(term, videoId);
    } catch (err) {
      if (err.code !== 'SQLITE_CONSTRAINT_FOREIGNKEY') throw err;
    }
  },
  getSearchTermVideo: (term) => {
    const row = db.prepare('SELECT video_id FROM search_cache WHERE term = ?').get(term);
    return row ? row.video_id : null;
  },
  // Related Videos Caching
  saveRelatedVideos: (sourceVideoId, relatedVideos) => {
    const data = JSON.stringify(relatedVideos);
    const stmt = db.prepare(`
      INSERT INTO related_videos_cache (source_video_id, data, fetched_at)
      VALUES (?, ?, unixepoch())
      ON CONFLICT(source_video_id) DO UPDATE SET
        data = excluded.data,
        fetched_at = unixepoch()
    `);
    stmt.run(sourceVideoId, data);
  },
  getRelatedVideos: (sourceVideoId) => {
    const row = db.prepare('SELECT data, fetched_at FROM related_videos_cache WHERE source_video_id = ?').get(sourceVideoId);
    if (!row) return null;
    try {
      return {
        data: JSON.parse(row.data),
        fetched_at: row.fetched_at
      };
    } catch (e) {
      logger.error("Failed to parse related videos cache:", e);
      return null;
    }
  },
  deleteUser: (userId) => {
    // 1. Get User Email for double-tap deletion (prevents email unique constraint zombies)
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
    const userEmail = user ? user.email : null;

    // Do not log email or stable user identifiers (PII); GDPR-compliant logging
    logger.info('[DB DELETE] Starting cleanup for user (ID redacted).');

    const transaction = db.transaction(() => {
      // Sessions
      const s1 = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);

      // Rooms
      const r1 = db.prepare('DELETE FROM rooms WHERE owner_id = ?').run(userId);

      // Users (Primary ID)
      const u1 = db.prepare('DELETE FROM users WHERE id = ?').run(userId);

      // Users (Email cleanup explanation: If ID somehow changed or we have a zombie row with same email)
      let u2 = { changes: 0 };
      if (userEmail) {
        u2 = db.prepare('DELETE FROM users WHERE email = ? AND id != ?').run(userEmail, userId);
      }

      // Snapshots of rooms the user participated in but doesn't own (owned
      // rooms were just deleted above, CASCADE removes their snapshots)
      // still embed their votes and suggestions — scrub those too, or the
      // user's id and display name resurface when such a room is reloaded.
      const st = module.exports.scrubUserFromRoomStates(userId);

      logger.info(`[DB DELETE] Result - Sessions: ${s1.changes}, Rooms: ${r1.changes}, Users(ID): ${u1.changes}, Users(Email cleanup): ${u2.changes}, Room states scrubbed: ${st}`);
    });

    try {
      transaction();
      // FORCE synchronous write to disk and clear WAL
      db.pragma('wal_checkpoint(TRUNCATE)');
      return true;
    } catch (err) {
      logger.error("[DB] deleteUser Transaction Failed:", err);
      throw err;
    }
  },

  // GDPR: scrub a deleted user's voters/suggestedBy entries from ALL
  // room_state snapshots. Room.scrubDeletedUser covers rooms loaded in
  // memory; this covers the unloaded ones. Called inside deleteUser's
  // transaction so erasure is atomic.
  scrubUserFromRoomStates: (userId) => {
    const rows = db.prepare('SELECT room_id, state_json FROM room_state').all();
    const update = db.prepare('UPDATE room_state SET state_json = ? WHERE room_id = ?');
    let scrubbed = 0;
    for (const row of rows) {
      const { json, changed } = scrubUserFromState(row.state_json, userId);
      if (changed) {
        update.run(json, row.room_id);
        scrubbed++;
      }
    }
    return scrubbed;
  },

  backup: (destination) => {
    return db.backup(destination);
  },

  // Room History
  addToRoomHistory: (roomId, track) => {
    if (!track.videoId) return;

    const transaction = db.transaction(() => {
      // 1. Ensure the video exists in the videos table first
      module.exports.upsertVideo({
        id: track.videoId,
        title: track.title,
        artist: track.artist,
        thumbnail: track.thumbnail,
        duration: track.duration,
        category_id: track.category_id || '10',
        language: track.language || null
      });

      // 2. Insert or update the history record
      const playedAt = track.playedAt ? Math.floor(track.playedAt / 1000) : Math.floor(Date.now() / 1000);
      db.prepare(`
        INSERT INTO room_history (room_id, video_id, played_at)
        VALUES (?, ?, ?)
        ON CONFLICT(room_id, video_id) DO UPDATE SET
          played_at = excluded.played_at
      `).run(roomId, track.videoId, playedAt);
    });

    transaction();
  },

  getRoomHistory: (roomId) => {
    const rows = db.prepare(`
        SELECT v.*, h.played_at 
        FROM room_history h
        JOIN videos v ON h.video_id = v.id
        WHERE h.room_id = ?
        ORDER BY h.played_at ASC
    `).all(roomId);

    // Map DB rows back to the track object format expected by the frontend/Room.js
    return rows.map(row => ({
      ...row, // Contains title, artist, duration etc from videos table
      videoId: row.id,
      playedAt: row.played_at * 1000 // Convert back to milliseconds
    }));
  },

  removeFromRoomHistory: (roomId, videoId) => {
    db.prepare('DELETE FROM room_history WHERE room_id = ? AND video_id = ?').run(roomId, videoId);
  },

  // Sessions cleanup
  cleanupExpiredSessions: () => {
    const now = Math.floor(Date.now() / 1000);
    const result = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    logger.info(`[DB Cleanup] Removed ${result.changes} expired sessions.`);
    return result.changes;
  },

  saveRoomState: (roomId, state) => {
    const minimal = {
      queue: state.queue || [],
      currentTrack: state.currentTrack || null,
      progress: state.progress || 0,
      isPlaying: state.isPlaying || false,
    };
    const json = JSON.stringify(minimal);
    db.prepare(`
      INSERT INTO room_state (room_id, state_json, saved_at)
      VALUES (?, ?, unixepoch())
      ON CONFLICT(room_id) DO UPDATE SET
        state_json = excluded.state_json,
        saved_at = unixepoch()
    `).run(roomId, json);
  },

  loadRoomState: (roomId) => {
    const row = db.prepare('SELECT state_json, saved_at FROM room_state WHERE room_id = ?').get(roomId);
    if (!row) return null;
    try {
      return JSON.parse(row.state_json);
    } catch (e) {
      return null;
    }
  },

  deleteRoomState: (roomId) => {
    db.prepare('DELETE FROM room_state WHERE room_id = ?').run(roomId);
  },

  // Atomic room checkpoint: save state + update activity in one transaction
  saveRoomStateAndActivity: (roomId, state) => {
    const transaction = db.transaction(() => {
      module.exports.saveRoomState(roomId, state);
      module.exports.updateRoomActivity(roomId);
    });
    transaction();
  },

  cleanupRoomHistory: () => {
    // No-op: room_history stores room-video associations (application data),
    // not cached YouTube metadata. TOS compliance is handled by
    // cleanupStaleVideoMetadata which clears the videos table fields.
    // CASCADE deletion handles cleanup when rooms are deleted.
    return 0;
  },

  // YouTube API TOS: clear stale metadata but preserve video IDs for Auto-DJ history references
  cleanupStaleVideoMetadata: () => {
    const threshold = Math.floor(Date.now() / 1000) - (28 * 24 * 60 * 60);
    const result = db.prepare(`
      UPDATE videos
      SET title = NULL, artist = NULL, thumbnail = NULL,
          duration = NULL, category_id = NULL, language = NULL
      WHERE fetched_at < ? AND title IS NOT NULL
    `).run(threshold);
    logger.info(`[DB Cleanup] Cleared metadata from ${result.changes} stale video entries.`);
    return result.changes;
  },

  // YouTube API TOS: the videos-table cleanup doesn't touch the persisted room
  // state snapshot, which embeds title/artist/thumbnail. Strip those from states
  // not saved in 28 days (dormant rooms), keeping video IDs + app data so the
  // room rehydrates real metadata on the next join.
  cleanupStaleRoomStateMetadata: () => {
    const threshold = Math.floor(Date.now() / 1000) - (28 * 24 * 60 * 60);
    const rows = db.prepare('SELECT room_id, state_json FROM room_state WHERE saved_at < ?').all(threshold);
    const update = db.prepare('UPDATE room_state SET state_json = ? WHERE room_id = ?');
    let cleared = 0;
    for (const row of rows) {
      const { json, changed } = stripStateMetadata(row.state_json);
      if (changed) {
        update.run(json, row.room_id);
        cleared++;
      }
    }
    if (cleared > 0) {
      logger.info(`[DB Cleanup] Stripped stale metadata from ${cleared} room state(s).`);
    }
    return cleared;
  },

  cleanupSearchCache: () => {
    const threshold = Math.floor(Date.now() / 1000) - (28 * 24 * 60 * 60);
    const result = db.prepare('DELETE FROM search_cache WHERE created_at < ?').run(threshold);
    logger.info(`[DB Cleanup] Removed ${result.changes} stale search cache entries.`);
    return result.changes;
  },

  cleanupRelatedVideosCache: () => {
    const threshold = Math.floor(Date.now() / 1000) - (28 * 24 * 60 * 60);
    const result = db.prepare('DELETE FROM related_videos_cache WHERE fetched_at < ?').run(threshold);
    logger.info(`[DB Cleanup] Removed ${result.changes} stale related videos cache entries.`);
    return result.changes;
  },

  // YouTube API TOS: lobby_preview embeds cached metadata (title/artist/
  // thumbnail) for the lobby cards. LIST_ROOMS already stops *showing*
  // previews of rooms dormant for 28+ days — delete them too, so the cached
  // data doesn't outlive its display window in rooms that are never reloaded.
  cleanupStaleLobbyPreviews: () => {
    const threshold = Math.floor(Date.now() / 1000) - (28 * 24 * 60 * 60);
    const result = db.prepare(`
      UPDATE rooms SET lobby_preview = NULL
      WHERE lobby_preview IS NOT NULL AND COALESCE(last_active_at, 0) < ?
    `).run(threshold);
    if (result.changes > 0) {
      logger.info(`[DB Cleanup] Cleared ${result.changes} stale lobby preview(s).`);
    }
    return result.changes;
  },

  cleanupEmptyRooms: () => {
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
    // "Empty" requires dormancy, not just an empty room_history: history rows
    // only appear when a track finishes or is skipped, so a room whose owner
    // prepares a queue without playing it through (or who cleared the library
    // via removeFromRoomHistory) has none — deleting on history alone would
    // destroy an in-use room and its room_state snapshot via CASCADE.
    const result = db.prepare(`
      DELETE FROM rooms
      WHERE created_at < ?
        AND COALESCE(last_active_at, 0) < ?
        AND id NOT IN (SELECT DISTINCT room_id FROM room_history)
    `).run(sevenDaysAgo, sevenDaysAgo);
    if (result.changes > 0) {
      logger.info(`[DB Cleanup] Deleted ${result.changes} empty channels older than 7 days.`);
    }
    return result.changes;
  },

  // Atomic daily cleanup: batch all cleanup operations in one transaction
  runDailyCleanup: () => {
    const transaction = db.transaction(() => {
      module.exports.cleanupExpiredSessions();
      module.exports.cleanupStaleVideoMetadata();
      module.exports.cleanupStaleRoomStateMetadata();
      module.exports.cleanupSearchCache();
      module.exports.cleanupRelatedVideosCache();
      module.exports.cleanupStaleLobbyPreviews();
      module.exports.cleanupEmptyRooms();
    });
    transaction();
  }
};
