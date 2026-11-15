// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// Design proposal B ("Neu"), DEV previews only.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * While a page of the draft is on screen the document around it is light too:
 * the area behind an overscroll, and the phone's status bar.
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

/**
 * Rows that change places glide to their new one instead of jumping: each
 * child marked `data-flip="<id>"` starts where it was and moves home. The row
 * that climbs passes above the others.
 */
export function useFlip(containerRef, order) {
	const tops = useRef(new Map());

	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const now = new Map();
		for (const row of container.querySelectorAll('[data-flip]')) {
			const id = row.dataset.flip;
			const top = row.offsetTop;
			now.set(id, top);
			const before = tops.current.get(id);
			if (still || before === undefined || before === top || !row.animate) continue;
			const climbs = before > top;
			row.style.zIndex = climbs ? '2' : '1';
			const move = row.animate(
				[{ transform: `translateY(${before - top}px)` }, { transform: 'translateY(0)' }],
				{ duration: 480, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
			);
			move.onfinish = () => { row.style.zIndex = ''; };
			move.oncancel = move.onfinish;
		}
		tops.current = now;
	}, [containerRef, order]);
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
