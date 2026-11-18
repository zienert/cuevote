// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
//
// Budgets for work that costs the server something, counted per key: a network
// (client-ip.js netKey), a room. Each budget is a token bucket held in memory:
// `capacity` attempts at once, refilled evenly over `windowMs`. A budget of 5
// per minute therefore allows a burst of 5, then one more every 12 seconds.

// Every budget in one table, so the numbers can be read and tuned together.
const BUDGETS = Object.freeze({
    // Wrong room passwords. Each one costs a bcrypt comparison on the event
    // loop (~70 ms) and is a guess at somebody's party.
    roomPasswordPerNet: Object.freeze({ capacity: 5, windowMs: 60 * 1000 }),
    roomPasswordPerRoom: Object.freeze({ capacity: 30, windowMs: 60 * 1000 }),
});

/**
 * One token bucket per key. A key that has never spent anything, or has
 * refilled completely, holds no memory.
 */
function createTokenBuckets({ capacity, windowMs }, { now = Date.now } = {}) {
    const perMs = capacity / windowMs;
    const buckets = new Map(); // key -> { tokens, at, denied }

    // Tokens a key holds right now. A clock that steps back refills nothing.
    const tokensOf = (key) => {
        const bucket = buckets.get(key);
        if (!bucket) return capacity;
        return Math.min(capacity, bucket.tokens + Math.max(0, now() - bucket.at) * perMs);
    };

    const store = (key, tokens, denied) => {
        if (tokens >= capacity && !denied) buckets.delete(key);
        else buckets.set(key, { tokens, at: now(), denied });
    };

    return {
        /** Milliseconds until `key` has a token; 0 when it has one now. */
        waitMs(key) {
            const tokens = tokensOf(key);
            return tokens >= 1 ? 0 : Math.ceil((1 - tokens) / perMs);
        },

        /** Spends a token. False, spending nothing, when there is none. */
        take(key) {
            const tokens = tokensOf(key);
            if (tokens < 1) return false;
            store(key, tokens - 1, 0);
            return true;
        },

        /** Gives a token back, e.g. when the attempt turned out to be fine. */
        refund(key) {
            if (!buckets.has(key)) return;
            store(key, Math.min(capacity, tokensOf(key) + 1), buckets.get(key).denied);
        },

        /**
         * Notes that `key` was turned away. Returns how many times in a row:
         * 1 for the first refusal since it last got a token, so a caller can
         * log a run of refusals once instead of once per message.
         */
        noteDenied(key) {
            const denied = (buckets.get(key)?.denied || 0) + 1;
            store(key, tokensOf(key), denied);
            return denied;
        },

        /** Forgets keys that have refilled completely. */
        prune() {
            for (const key of [...buckets.keys()]) {
                if (tokensOf(key) >= capacity) buckets.delete(key);
            }
        },

        get size() {
            return buckets.size;
        },
    };
}

module.exports = { BUDGETS, createTokenBuckets };
