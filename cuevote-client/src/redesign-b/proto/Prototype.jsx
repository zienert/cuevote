// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// DEV-ONLY (route /__prototype, gated by import.meta.env.DEV in main.jsx, not
// bundled in production). Three different answers to one question of design
// proposal B: how does a guest vote on the titles that come next? Each is a
// working list in a phone's room; the picker flips between them.
//
//   1 Rangliste   the place leads: numerals, two arrows
//   2 Wischen     the gesture is the control: swipe a row
//   3 Wettlauf    the amount leads: bars as long as the votes
//
// Keys 1 to 3 and the arrow keys switch, R starts the current one again.
// ?v=2 opens a variant directly. The picker is the prototype skill's own:
// its markup, styles and behaviour are fixed (picker.css).
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { MotionConfig } from 'motion/react';
import '@fontsource-variable/sofia-sans-extra-condensed/index.css';
import '../b.css';
import './picker.css';
import { Consent } from '../../contexts/ConsentContext';
import { useExampleRoom, useLightPage } from '../lib';
import { RoomFrame } from './parts';
import { Rangliste } from './Rangliste';
import { Wischen } from './Wischen';
import { Wettlauf } from './Wettlauf';

const VARIANTS = [
	{ name: 'Rangliste', List: Rangliste },
	{ name: 'Wischen', List: Wischen },
	{ name: 'Wettlauf', List: Wettlauf },
];

function Stage({ variant }) {
	const List = variant.List;
	const room = useExampleRoom();
	return (
		<RoomFrame room={room}>
			<List room={room} />
		</RoomFrame>
	);
}

Stage.propTypes = { variant: PropTypes.shape({ List: PropTypes.elementType.isRequired }).isRequired };

function requested() {
	const number = parseInt(new URLSearchParams(window.location.search).get('v'), 10);
	return number >= 1 && number <= VARIANTS.length ? number - 1 : 0;
}

export default function Prototype() {
	useLightPage();
	// The cookie banner belongs to the real page: keep it closed here, as the
	// previews do. Nothing is accepted.
	const consent = Consent.useConsent();
	useEffect(() => {
		if (consent.showBanner) consent.setShowBanner(false);
	}, [consent]);

	const [current, setCurrent] = useState(requested);
	// Counts up to mount the variant afresh: on a switch and on replay.
	const [run, setRun] = useState(0);
	const picker = useRef(null);
	const highlight = useRef(null);
	const items = useRef([]);

	const select = useCallback((index) => {
		if (index < 0 || index >= VARIANTS.length) return;
		setCurrent(index);
		setRun((value) => value + 1);
	}, []);

	const moveHighlight = useCallback(() => {
		const item = items.current[current];
		if (!item || !highlight.current) return;
		highlight.current.style.width = `${item.offsetWidth}px`;
		highlight.current.style.transform = `translateX(${item.offsetLeft}px)`;
	}, [current]);
	useLayoutEffect(moveHighlight, [moveHighlight]);
	useEffect(() => {
		window.addEventListener('resize', moveHighlight);
		return () => window.removeEventListener('resize', moveHighlight);
	}, [moveHighlight]);

	useEffect(() => {
		const url = new URL(window.location.href);
		url.searchParams.set('v', String(current + 1));
		window.history.replaceState(null, '', url);
	}, [current]);

	useEffect(() => {
		const onKey = (event) => {
			if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable) return;
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			const number = parseInt(event.key, 10);
			if (number >= 1 && number <= VARIANTS.length) select(number - 1);
			else if (event.key === 'ArrowRight') select((current + 1) % VARIANTS.length);
			else if (event.key === 'ArrowLeft') select((current - 1 + VARIANTS.length) % VARIANTS.length);
			else if (event.key === 'r' || event.key === 'R') setRun((value) => value + 1);
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [current, select]);

	// The highlight slides only after the first paint, so loading doesn't animate.
	useEffect(() => {
		let second = 0;
		const first = requestAnimationFrame(() => {
			second = requestAnimationFrame(() => picker.current?.setAttribute('data-ready', ''));
		});
		return () => {
			cancelAnimationFrame(first);
			cancelAnimationFrame(second);
		};
	}, []);

	return (
		<MotionConfig reducedMotion="user">
			<div className="min-h-dvh bg-card">
				<Stage key={`${current}-${run}`} variant={VARIANTS[current]} />
			</div>
			{/* At the top: the room's own bar holds the bottom centre. */}
			<nav ref={picker} className="proto-picker" aria-label="Prototype variants" data-position="top">
				<span ref={highlight} className="proto-picker-highlight" aria-hidden="true" />
				{VARIANTS.map((variant, index) => (
					<button
						key={variant.name}
						ref={(element) => { items.current[index] = element; }}
						type="button"
						className="proto-picker-item"
						data-active={index === current ? '' : undefined}
						aria-current={index === current ? 'true' : undefined}
						onClick={() => select(index)}
					>
						{variant.name}
					</button>
				))}
				<span className="proto-picker-divider" aria-hidden="true" />
				<button type="button" className="proto-picker-item proto-picker-replay" aria-label="Replay animation (R)" onClick={() => setRun((value) => value + 1)}>↻</button>
			</nav>
		</MotionConfig>
	);
}
