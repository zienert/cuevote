// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// DEV-ONLY prototype (/__prototype), variant "Wischen".
// Axis: the gesture is the control. No vote buttons: a row follows the finger,
// to the right for a vote up, to the left for a vote down, and what the
// release will do shows under it. Quiet rows, one number each.
import React, { forwardRef, useState } from 'react';
import PropTypes from 'prop-types';
import { AnimatePresence, motion as Motion, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform } from 'motion/react';
import NumberFlow from '@number-flow/react';
import { ArrowBigDown, ArrowBigUp } from 'lucide-react';
import { SPRING } from '../lib';
import { Cover, ListHeading } from './parts';
import { roomShape, trackShape } from './shapes';

// The row follows the finger 1:1 this far, then resists.
const REACH = 96;
// Past this the release counts as a vote; a fast flick counts from anywhere.
const COMMIT = 64;
const FLICK = 500;

const Row = forwardRef(function Row({ track, onVote }, ref) {
	const reduce = useReducedMotion();
	const x = useMotionValue(0);
	// What waits under the row grows in with the pull: one source for both.
	const upShown = useTransform(x, [0, COMMIT], [0, 1]);
	const downShown = useTransform(x, [-COMMIT, 0], [1, 0]);
	const [armed, setArmed] = useState(null);
	useMotionValueEvent(x, 'change', (value) => {
		const next = value > COMMIT ? 'up' : value < -COMMIT ? 'down' : null;
		if (next !== armed) setArmed(next);
	});

	return (
		<Motion.li
			ref={ref}
			layout="position"
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0 }}
			transition={SPRING}
			className="relative overflow-hidden rounded-2xl bg-card"
		>
			{/* Under the row: what a release will do. */}
			<div aria-hidden="true" className="absolute inset-0 flex items-center justify-between px-3 text-[0.9375rem] font-semibold">
				<Motion.span style={{ opacity: upShown }} className={`flex items-center gap-1.5 transition-transform duration-150 ease-cv ${armed === 'up' ? 'scale-110 b-accent-text' : 'text-ink-2'}`}>
					<ArrowBigUp size={22} fill={armed === 'up' ? 'currentColor' : 'none'} /> Dafür
				</Motion.span>
				<Motion.span style={{ opacity: downShown }} className={`flex items-center gap-1.5 transition-transform duration-150 ease-cv ${armed === 'down' ? 'scale-110 text-ink' : 'text-ink-2'}`}>
					Dagegen <ArrowBigDown size={22} fill={armed === 'down' ? 'currentColor' : 'none'} />
				</Motion.span>
			</div>

			<Motion.div
				drag="x"
				dragDirectionLock
				dragConstraints={{ left: -REACH, right: REACH }}
				dragElastic={0.18}
				dragMomentum={false}
				dragSnapToOrigin
				// Back home on a spring that keeps the finger's speed; the little
				// overshoot only because a hand let go of it.
				dragTransition={{ bounceStiffness: 420, bounceDamping: reduce ? 60 : 30 }}
				onDragEnd={(_event, info) => {
					if (info.offset.x > COMMIT || info.velocity.x > FLICK) onVote(track.id, 'up');
					else if (info.offset.x < -COMMIT || info.velocity.x < -FLICK) onVote(track.id, 'down');
				}}
				style={{ x, touchAction: 'pan-y' }}
				className="relative flex cursor-grab items-center gap-3 bg-page py-2 pl-2 pr-4 active:cursor-grabbing"
			>
				<span aria-hidden="true" className={`absolute inset-y-2 left-0 w-1 rounded-full ${track.mine === 'up' ? 'bg-accent' : track.mine === 'down' ? 'bg-ink' : 'bg-transparent'}`} />
				<Cover src={track.cover} />
				<div className="min-w-0 flex-1">
					<p className="truncate font-semibold leading-6 text-ink">{track.title}</p>
					<p className="truncate text-[0.9375rem] leading-5 text-ink-2">{track.artist}</p>
				</div>
				<span className={`flex flex-none items-center gap-1 font-semibold tabular-nums ${track.mine === 'up' ? 'b-accent-text' : 'text-ink'}`}>
					{track.mine === 'up' ? <ArrowBigUp size={18} fill="currentColor" aria-hidden="true" /> : null}
					{track.mine === 'down' ? <ArrowBigDown size={18} fill="currentColor" aria-hidden="true" /> : null}
					<NumberFlow value={track.score} />
				</span>
			</Motion.div>

			{/* For a keyboard and a screen reader: the same two votes as buttons,
			    out of sight until they have the focus. */}
			<div className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:inset-y-0 focus-within:right-2 focus-within:z-10 focus-within:flex focus-within:items-center focus-within:gap-1">
				<button type="button" aria-pressed={track.mine === 'up'} onClick={() => onVote(track.id, 'up')} className="h-11 rounded-full bg-accent px-4 font-semibold text-accent-ink">
					Dafür<span className="sr-only">: {track.title}</span>
				</button>
				<button type="button" aria-pressed={track.mine === 'down'} onClick={() => onVote(track.id, 'down')} className="h-11 rounded-full bg-ink px-4 font-semibold text-page">
					Dagegen<span className="sr-only">: {track.title}</span>
				</button>
			</div>
		</Motion.li>
	);
});

Row.propTypes = { track: trackShape.isRequired, onVote: PropTypes.func.isRequired };

export function Wischen({ room }) {
	return (
		<section className="px-3 pb-6">
			<ListHeading count={room.tracks.length} hint="Nach rechts wischen: dafür. Nach links: dagegen." />
			<ol className="space-y-1.5 [overflow-anchor:none]">
				<AnimatePresence initial={false} mode="popLayout">
					{room.tracks.map((track) => (
						<Row key={track.id} track={track} onVote={room.vote} />
					))}
				</AnimatePresence>
			</ol>
		</section>
	);
}

Wischen.propTypes = { room: roomShape.isRequired };
