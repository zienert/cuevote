// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert

/**
 * Where the room is in its current track, in seconds: the position the
 * server last gave, counted on while the room runs. The server tells it
 * every few seconds, and at once when it changes by hand.
 *
 * @param {{ current: number }} progressRef the position the server last gave
 * @param {{ current: number }} progressAtRef when it gave it (Date.now())
 * @param {boolean} running the room plays and is not waiting for its host
 */
export function roomPositionNow(progressRef, progressAtRef, running) {
	const told = Number(progressRef?.current) || 0;
	if (!running || !progressAtRef?.current) return told;
	return told + Math.max(0, (Date.now() - progressAtRef.current) / 1000);
}
