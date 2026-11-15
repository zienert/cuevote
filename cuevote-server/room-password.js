// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
//
// Room passwords. Checking one costs a bcrypt comparison, and a wrong one is a
// guess at somebody's party, so guesses are paid for out of a budget per
// network and per room that is consulted BEFORE bcrypt runs: past it, an
// attempt is turned away at no cost, whether its password is right or not.
// A right password gets its guess back, so guests who know it never use up the
// budget, however many of them join or reconnect from one router.

const { BUDGETS, createTokenBuckets } = require('./limits');

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

module.exports = { createAttemptBudget };
