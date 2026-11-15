// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// Design proposal B ("Neu"), DEV previews only: hooks and helpers.
import { useEffect, useState } from 'react';

/**
 * While a page of the draft is on screen the document around it is the
 * draft's too: its colours (b.css hangs them on html[data-design="b"], so
 * sheets and dialogs at the end of <body> get them), the area behind an
 * overscroll, and the phone's status bar. Light whatever the device's theme.
 */
export function useLightPage() {
	useEffect(() => {
		const root = document.documentElement;
		const meta = document.querySelector('meta[name="theme-color"]');
		const before = { design: root.dataset.design, theme: meta?.getAttribute('content') };
		root.dataset.design = 'b';
		meta?.setAttribute('content', '#ffffff');
		return () => {
			if (before.design) root.dataset.design = before.design;
			else delete root.dataset.design;
			if (meta && before.theme) meta.setAttribute('content', before.theme);
		};
	}, []);
}

/** Seconds of the current track, counted on while it plays. */
export function useProgress(startSeconds, startedAt, isPlaying, duration) {
	const [seconds, setSeconds] = useState(startSeconds);
	useEffect(() => {
		const read = () => {
			const elapsed = isPlaying ? (Date.now() - startedAt) / 1000 : 0;
			setSeconds(Math.min(duration || Infinity, startSeconds + elapsed));
		};
		read();
		if (!isPlaying) return undefined;
		const timer = setInterval(read, 1000);
		return () => clearInterval(timer);
	}, [startSeconds, startedAt, isPlaying, duration]);
	return seconds;
}

/** m:ss */
export function clock(seconds) {
	const whole = Math.max(0, Math.floor(seconds || 0));
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * By how many places a row has just moved: positive when it climbed. Back to
 * 0 a moment later, so a marker next to the place shows only the change.
 */
export function useRankChange(rank) {
	const [seen, setSeen] = useState(rank);
	const [change, setChange] = useState(0);
	if (rank !== seen) {
		setSeen(rank);
		setChange(seen - rank);
	}
	useEffect(() => {
		if (!change) return undefined;
		const timer = setTimeout(() => setChange(0), 1800);
		return () => clearTimeout(timer);
	}, [change, rank]);
	return change;
}

// The moves of the draft, in the words of Apple's springs: no overshoot for
// anything a button causes, a little only where a finger threw something.
export const SPRING = { type: 'spring', duration: 0.4, bounce: 0 };
export const SPRING_THROWN = { type: 'spring', duration: 0.45, bounce: 0.2 };

// Stage-light stand-ins for cover art: generated, so an example loads
// nothing from YouTube or Apple and needs no consent.
const PALETTES = [
	['#10151f', '#f59e0b', '#be185d'], ['#0a1410', '#22c55e', '#0ea5e9'], ['#1f1021', '#ec4899', '#8b5cf6'],
	['#0f172a', '#38bdf8', '#f472b6'], ['#1c1917', '#facc15', '#ea580c'], ['#111827', '#a78bfa', '#34d399'],
	['#1a0b2e', '#ff6a3d', '#6b2bd9'], ['#0b1d2e', '#2dd4bf', '#1e3a8a'], ['#120d0a', '#ef4444', '#f97316'],
];
export function exampleCover(index) {
	const [base, glowA, glowB] = PALETTES[index % PALETTES.length];
	const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">'
		+ `<defs><radialGradient id="a" cx="20%" cy="15%" r="80%"><stop offset="0" stop-color="${glowA}"/><stop offset="1" stop-color="${glowA}" stop-opacity="0"/></radialGradient>`
		+ `<radialGradient id="b" cx="85%" cy="85%" r="75%"><stop offset="0" stop-color="${glowB}"/><stop offset="1" stop-color="${glowB}" stop-opacity="0"/></radialGradient></defs>`
		+ `<rect width="240" height="240" fill="${base}"/><rect width="240" height="240" fill="url(#a)"/><rect width="240" height="240" fill="url(#b)"/></svg>`;
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// A party's queue to try things on: real titles, generated covers. The votes
// stand close together, so that a single vote already changes a place.
const EXAMPLE = [
	['Flowers', 'Miley Cyrus', 4, 'Alex'], ['Mr. Brightside', 'The Killers', 3, 'Mia'], ['Bad Guy', 'Billie Eilish', 3, 'K7QF'],
	['99 Luftballons', 'Nena', 2, 'Lukas'], ['Uptown Funk', 'Mark Ronson ft. Bruno Mars', 2, 'P2MX'], ['Dance Monkey', 'Tones and I', 1, 'Alex'],
	['Shape of You', 'Ed Sheeran', 0, 'Mia'],
];
export const EXAMPLE_PLAYING = { id: 'now', title: 'As It Was', artist: 'Harry Styles', cover: exampleCover(8) };

/**
 * An example room that answers like the real one: one vote per person and
 * title, a second press takes it back, the list sorts by votes and keeps the
 * order of arrival between equals.
 */
export function useExampleRoom(size = EXAMPLE.length) {
	const [tracks, setTracks] = useState(() => EXAMPLE.slice(0, size).map(([title, artist, score, by], i) => ({ id: `t${i}`, title, artist, score, by, cover: exampleCover(i), arrived: i })));
	const sort = (list) => [...list].sort((a, b) => (b.score - a.score) || (a.arrived - b.arrived));
	const vote = (id, direction) => setTracks((current) => sort(current.map((track) => {
		if (track.id !== id) return track;
		const before = track.mine === 'up' ? 1 : track.mine === 'down' ? -1 : 0;
		const mine = track.mine === direction ? undefined : direction;
		const after = mine === 'up' ? 1 : mine === 'down' ? -1 : 0;
		return { ...track, mine, score: track.score - before + after };
	})));
	const add = (title) => setTracks((current) => sort([...current, { id: `t${Date.now()}`, title, artist: 'CueVote', score: 0, by: 'Du', cover: exampleCover(current.length), arrived: Date.now() }]));
	return { tracks, vote, add };
}
