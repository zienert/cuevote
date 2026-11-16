// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
//
// Room passwords. Checking one costs a bcrypt comparison, and a wrong one is a
// guess at somebody's party, so guesses are paid for out of a budget per
// network and per room that is consulted BEFORE bcrypt runs: past it, an
// attempt is turned away at no cost, whether its password is right or not.
// A right password gets its guess back, so guests who know it never use up the
// budget, however many of them join or reconnect from one router.
//
// bcryptjs computes on the event loop, about 70 ms per check at cost 10. Run
// asynchronously it hands the loop back between checks (and between 100 ms
// slices of a slow one), and a semaphore keeps at most two under way, so other
// rooms' messages and timers never wait behind more than that, even when many
// networks guess at once.

const bcrypt = require('bcryptjs');
const { BUDGETS, createTokenBuckets } = require('./limits');

// bcrypt cost for new room passwords; existing hashes keep their own.
const BCRYPT_COST = 10;
const MAX_CONCURRENT_BCRYPT = 2;

function createAttemptBudget({
    perNet = BUDGETS.roomPasswordPerNet,
    perRoom = BUDGETS.roomPasswordPerRoom,
    now = Date.now,
} = {}) {
    const nets = createTokenBuckets(perNet, { now });
    const rooms = createTokenBuckets(perRoom, { now });

    /**
     * Null while this network and this room may still guess; otherwise why
     * not: { ok: false, reason: 'limited', scope: 'net' | 'room', retryAfter
     * (whole seconds until both have a guess again), firstDenial }.
     */
    function denial(netKey, roomId) {
        const netWait = nets.waitMs(netKey);
        const roomWait = rooms.waitMs(roomId);
        if (netWait === 0 && roomWait === 0) return null;
        const scope = netWait >= roomWait ? 'net' : 'room';
        const inARow = scope === 'net' ? nets.noteDenied(netKey) : rooms.noteDenied(roomId);
        return {
            ok: false,
            reason: 'limited',
            scope,
            retryAfter: Math.max(1, Math.ceil(Math.max(netWait, roomWait) / 1000)),
            firstDenial: inARow === 1,
        };
    }

    return {
        denial,

        /**
         * Spends one guess for this network and this room, or returns the
         * denial. A spent guess comes with refund(): call it when the password
         * was right (or could not be checked), so only wrong ones count.
         */
        spend(netKey, roomId) {
            const refused = denial(netKey, roomId);
            if (refused) return refused;
            nets.take(netKey);
            rooms.take(roomId);
            let refunded = false;
            return {
                ok: true,
                refund() {
                    if (refunded) return;
                    refunded = true;
                    nets.refund(netKey);
                    rooms.refund(roomId);
                },
            };
        },

        /** Forgets networks and rooms whose budget is full again. */
        prune() {
            nets.prune();
            rooms.prune();
        },
    };
}

/** Runs at most `limit` tasks at a time; the others wait their turn in order. */
function createSemaphore(limit) {
    let running = 0;
    const waiting = [];

    const next = () => {
        while (running < limit && waiting.length > 0) {
            const { task, resolve, reject } = waiting.shift();
            running++;
            // The slot is free again before the caller hears the outcome.
            const finish = (settle) => (outcome) => {
                running--;
                next();
                settle(outcome);
            };
            Promise.resolve().then(task).then(finish(resolve), finish(reject));
        }
    };

    return {
        run(task) {
            return new Promise((resolve, reject) => {
                waiting.push({ task, resolve, reject });
                next();
            });
        },
        get running() {
            return running;
        },
        get waiting() {
            return waiting.length;
        },
    };
}

/**
 * Room password work for the server: the attempt budget first, then bcrypt,
 * asynchronously and at most `concurrency` at a time.
 */
function createRoomPasswordGuard({
    budget = createAttemptBudget(),
    compare = (password, passwordHash) => bcrypt.compare(password, passwordHash),
    hash = (password) => bcrypt.hash(password, BCRYPT_COST),
    concurrency = MAX_CONCURRENT_BCRYPT,
} = {}) {
    const gate = createSemaphore(concurrency);

    return {
        /**
         * Checks a guest's password for a room. Resolves with { ok: true },
         * { ok: false, reason: 'wrong' }, or the budget's denial ({ ok: false,
         * reason: 'limited', ... }), in which case bcrypt did not run.
         */
        async verify({ password, passwordHash, netKey, roomId }) {
            // Out of guesses already: say so now, not after a wait in line.
            const refused = budget.denial(netKey, roomId);
            if (refused) return refused;

            return gate.run(async () => {
                // Attempts from the same network queued ahead of this one may
                // have used its guesses up meanwhile, so the budget decides
                // again now that bcrypt would run. Only checks under way hold
                // a guess: a crowd that knows the password queues up freely.
                const attempt = budget.spend(netKey, roomId);
                if (!attempt.ok) return attempt;
                let match;
                try {
                    match = await compare(password, passwordHash);
                } catch (err) {
                    attempt.refund(); // our failure, not the guest's guess
                    throw err;
                }
                if (match) {
                    attempt.refund();
                    return { ok: true };
                }
                return { ok: false, reason: 'wrong' };
            });
        },

        /** A bcrypt hash for a new room password, in line with the checks. */
        hash(password) {
            return gate.run(() => hash(password));
        },

        prune() {
            budget.prune();
        },
    };
}

module.exports = { createAttemptBudget, createSemaphore, createRoomPasswordGuard };
