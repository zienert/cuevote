// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
//
// The queue's ordering rule, in one place.
//
// Index 0 is the track that is playing: the client mirrors it as currentTrack,
// so reordering it skips a song mid-play with nothing in the logs to say why.
// Three separate call sites used to re-implement "slice off the head, sort the
// rest, put the head back", which is three chances to get that invariant wrong.

// suggestedBy of the tracks the Auto-DJ ("Channel Mix") queues from history.
const AUTO_DJ = 'System';

const isAutoDjPick = (track) => track.suggestedBy === AUTO_DJ;

/**
 * Ordering for the upcoming part of the queue: an owner's priority pick first,
 * then the songs people asked for, then the Auto-DJ's picks, each by highest
 * score. Ties keep their arrival order, because Array#sort is stable — that is
 * what makes the queue first-come-first-served at equal votes.
 *
 * The Auto-DJ only fills gaps. It queues up to half the queue size at once, so
 * a song asked for after a refill would otherwise wait behind all of it.
 */
function compareUpcoming(a, b) {
    if (a.isOwnerPriority && !b.isOwnerPriority) return -1;
    if (!a.isOwnerPriority && b.isOwnerPriority) return 1;
    if (isAutoDjPick(a) !== isAutoDjPick(b)) return isAutoDjPick(a) ? 1 : -1;
    return (b.score || 0) - (a.score || 0);
}

/**
 * A new queue array with everything after index 0 reordered.
 *
 * Never mutates the input and never moves the head. A queue of fewer than two
 * tracks comes back as a copy: there is nothing to order, and the head is not
 * something to touch.
 */
function sortUpcoming(queue) {
    if (!Array.isArray(queue)) return queue;
    if (queue.length < 2) return [...queue];

    const [current, ...upcoming] = queue;
    upcoming.sort(compareUpcoming);
    return [current, ...upcoming];
}

module.exports = { sortUpcoming, compareUpcoming, AUTO_DJ };
