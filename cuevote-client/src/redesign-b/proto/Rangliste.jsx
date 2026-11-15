// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// DEV-ONLY prototype (/__prototype), variant "Rangliste".
// Axis: the place leads. Every title carries its place as a large numeral,
// two arrows move it up or down, and a row that changes place travels there
// and says for a moment by how many places.
import React, { forwardRef } from 'react';
import PropTypes from 'prop-types';
import { AnimatePresence, motion as Motion } from 'motion/react';
import NumberFlow from '@number-flow/react';
import { ArrowBigDown, ArrowBigUp } from 'lucide-react';
import { SPRING, useRankChange } from '../lib';
import { Cover, ListHeading } from './parts';
import { roomShape, trackShape } from './shapes';

const arrow = 'cv-hit flex h-10 w-10 flex-none items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 ease-cv active:scale-90';

const Row = forwardRef(function Row({ track, rank, onVote }, ref) {
	const change = useRankChange(rank);
	const leads = rank === 1;
	return (
		<Motion.li
			ref={ref}
			layout="position"
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0 }}
			transition={SPRING}
			// The row that climbs passes above the ones it overtakes.
			style={{ zIndex: change > 0 ? 2 : 1 }}
			className={`relative flex items-center gap-2.5 rounded-2xl py-2 pl-1 pr-1 ${leads ? 'bg-[#fff1ea]' : 'bg-page'}`}
		>
			<span className="relative flex w-9 flex-none flex-col items-center">
				<span className={`b-num text-[2.25rem] ${leads ? 'b-accent-text' : 'text-ink'}`}>{rank}</span>
				{/* By how many places it has just moved; gone again after a moment. */}
				<span
					aria-hidden="true"
					className={`absolute -bottom-3 text-[0.6875rem] font-bold leading-none tabular-nums transition-opacity duration-200 ${change ? 'opacity-100' : 'opacity-0'} ${change > 0 ? 'b-accent-text' : 'text-ink-3'}`}
				>
					{change > 0 ? `▲ ${change}` : change < 0 ? `▼ ${-change}` : ''}
				</span>
			</span>
			<Cover src={track.thumbnail} />
			<div className="min-w-0 flex-1">
				<p className="truncate font-semibold leading-6 text-ink">{track.title}</p>
				<p className="truncate text-[0.9375rem] leading-5 text-ink-2">{track.artist}</p>
			</div>
			<div className="flex flex-none items-center">
				<button
					type="button"
					aria-pressed={track.myVote === 'up'}
					aria-label={`Nach oben stimmen: ${track.title}`}
					onClick={() => onVote(track.id, 'up')}
					className={`${arrow} ${track.myVote === 'up' ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:bg-card hover:text-ink'}`}
				>
					<ArrowBigUp size={24} strokeWidth={1.75} fill={track.myVote === 'up' ? 'currentColor' : 'none'} />
				</button>
				<span className={`min-w-7 text-center font-semibold tabular-nums ${track.myVote === 'up' ? 'b-accent-text' : 'text-ink'}`}>
					<NumberFlow value={track.score} />
				</span>
				<button
					type="button"
					aria-pressed={track.myVote === 'down'}
					aria-label={`Nach unten stimmen: ${track.title}`}
					onClick={() => onVote(track.id, 'down')}
					className={`${arrow} ${track.myVote === 'down' ? 'bg-ink text-page' : 'text-ink-2 hover:bg-card hover:text-ink'}`}
				>
					<ArrowBigDown size={24} strokeWidth={1.75} fill={track.myVote === 'down' ? 'currentColor' : 'none'} />
				</button>
			</div>
		</Motion.li>
	);
});

Row.propTypes = { track: trackShape.isRequired, rank: PropTypes.number.isRequired, onVote: PropTypes.func.isRequired };

export function Rangliste({ room }) {
	return (
		<section className="px-3 pb-6">
			<ListHeading count={room.tracks.length} />
			<ol className="space-y-1 [overflow-anchor:none]">
				<AnimatePresence initial={false} mode="popLayout">
					{room.tracks.map((track, index) => (
						<Row key={track.id} track={track} rank={index + 1} onVote={room.vote} />
					))}
				</AnimatePresence>
			</ol>
		</section>
	);
}

Rangliste.propTypes = { room: roomShape.isRequired };
