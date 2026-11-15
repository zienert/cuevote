// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// DEV-ONLY prototype (/__prototype), variant "Wettlauf".
// Axis: the amount leads. Every title has a bar as long as its votes, so the
// list reads as a race: how close two titles are shows before any number is
// read. One big button adds a vote, a small one takes one away.
import React, { forwardRef } from 'react';
import PropTypes from 'prop-types';
import { AnimatePresence, motion as Motion } from 'motion/react';
import NumberFlow from '@number-flow/react';
import { Minus, Plus } from 'lucide-react';
import { SPRING } from '../lib';
import { Cover, ListHeading } from './parts';
import { roomShape, trackShape } from './shapes';

const Row = forwardRef(function Row({ track, share, leads, onVote }, ref) {
	return (
		<Motion.li
			ref={ref}
			layout="position"
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0 }}
			transition={SPRING}
			className="relative flex h-16 items-center gap-3 overflow-hidden rounded-2xl bg-card pl-2 pr-2"
		>
			{/* The bar: scaled, not resized, from the left edge. */}
			<Motion.span
				aria-hidden="true"
				initial={false}
				animate={{ scaleX: share }}
				transition={SPRING}
				className={`absolute inset-0 origin-left ${leads ? 'bg-accent/40' : 'bg-accent/[0.16]'}`}
			/>
			<Cover src={track.thumbnail} />
			<div className="relative min-w-0 flex-1">
				<p className="truncate font-semibold leading-6 text-ink">{track.title}</p>
				<p className="truncate text-[0.9375rem] leading-5 text-ink-2">{track.artist}</p>
			</div>
			<span className="b-num relative min-w-7 flex-none text-center text-[1.875rem] text-ink">
				<NumberFlow value={track.score} />
			</span>
			<button
				type="button"
				aria-pressed={track.myVote === 'down'}
				aria-label={`Eine Stimme dagegen: ${track.title}`}
				onClick={() => onVote(track.id, 'down')}
				className={`cv-hit relative flex h-9 w-9 flex-none items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 ease-cv active:scale-90 ${track.myVote === 'down' ? 'bg-ink text-page' : 'bg-page/70 text-ink-2 hover:text-ink'}`}
			>
				<Minus size={18} strokeWidth={2.5} />
			</button>
			<button
				type="button"
				aria-pressed={track.myVote === 'up'}
				aria-label={`Eine Stimme dafür: ${track.title}`}
				onClick={() => onVote(track.id, 'up')}
				className={`relative flex h-11 w-11 flex-none items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 ease-cv active:scale-90 ${track.myVote === 'up' ? 'bg-ink text-page' : 'bg-accent text-accent-ink'}`}
			>
				<Plus size={22} strokeWidth={2.75} />
			</button>
		</Motion.li>
	);
});

Row.propTypes = { track: trackShape.isRequired, share: PropTypes.number.isRequired, leads: PropTypes.bool, onVote: PropTypes.func.isRequired };

export function Wettlauf({ room }) {
	const most = Math.max(1, ...room.tracks.map((track) => track.score));
	return (
		<section className="px-3 pb-6">
			<ListHeading count={room.tracks.length} />
			<ol className="space-y-1.5 [overflow-anchor:none]">
				<AnimatePresence initial={false} mode="popLayout">
					{room.tracks.map((track, index) => (
						<Row
							key={track.id}
							track={track}
							leads={index === 0 && track.score > 0}
							// A sliver even without votes, so every title is in the race.
							share={track.score > 0 ? 0.14 + 0.86 * (track.score / most) : 0.04}
							onVote={room.vote}
						/>
					))}
				</AnimatePresence>
			</ol>
		</section>
	);
}

Wettlauf.propTypes = { room: roomShape.isRequired };
