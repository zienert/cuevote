// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// Design proposal B ("Neu"), DEV previews only: the ranking.
//
// The one loud thing of the draft, taken from the prototype's variant
// "Rangliste": every title carries its place as a large numeral, two arrows
// move it up or down, and a row that changes place travels there and says
// for a moment by how many places. The title at the top is the one that
// plays next.
import React, { forwardRef } from 'react';
import PropTypes from 'prop-types';
import clsx from 'clsx';
import { AnimatePresence, motion as Motion } from 'motion/react';
import NumberFlow from '@number-flow/react';
import { ArrowBigDown, ArrowBigUp } from 'lucide-react';
import { Language } from '../contexts/LanguageContext';
import { Skeleton } from '../components/Skeleton';
import { formatCount } from '../utils/numbers';
import { SPRING, useRankChange } from './lib';
import { useCopy } from './copy';
import { Cover } from './ui';

// Past this many rows a change of place is instant: nobody sees a row that
// far down move, and measuring hundreds of them costs every vote.
const ANIMATED_ROWS = 40;

// 36 px to look at, 44 px to hit (cv-hit).
const arrow = 'cv-hit flex h-9 w-9 flex-none items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 ease-cv active:scale-90';

const Row = forwardRef(function Row({ track, rank, animated, cover, canVote, onVote, onOpen, locale }, ref) {
	const { t, language } = Language.useLanguage();
	const c = useCopy();
	const change = useRankChange(rank);
	const leads = rank === 1;
	const score = track.score || 0;

	const text = (
		<>
			<Cover src={cover.src} allowed={cover.allowed} className="b-chart-cover" />
			<span className="block min-w-0 flex-1">
				{track.title ? (
					// The title says which song it is: up to two lines rather than cut short.
					<span dir="auto" className="cv-bidi line-clamp-2 break-words font-semibold leading-[1.3] text-ink">{track.title}</span>
				) : (
					// The title is on its way (cleared after YouTube's 28 days).
					<Skeleton className="h-4 w-36 max-w-full bg-raised" />
				)}
				{track.artist ? (
					<span dir="auto" className="cv-bidi block truncate text-[0.9375rem] leading-5 text-ink-2">{track.artist}</span>
				) : track.title ? null : (
					<Skeleton className="mt-2 h-3 w-20 max-w-full bg-raised" />
				)}
			</span>
		</>
	);

	return (
		<Motion.li
			ref={ref}
			layout={animated ? 'position' : false}
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0 }}
			transition={SPRING}
			// The row that climbs passes above the ones it overtakes.
			style={{ zIndex: change > 0 ? 2 : 1 }}
			className={clsx('relative flex items-center gap-2.5 rounded-2xl py-2 pl-1 pr-1', leads ? 'bg-[#fff1ea]' : 'bg-page')}
		>
			<span className="relative flex w-8 flex-none flex-col items-center" aria-label={`${c('room.place')} ${rank}`}>
				<span aria-hidden="true" className={clsx('b-num text-[2.25rem]', leads ? 'b-accent-text' : 'text-ink')}>{rank}</span>
				{/* By how many places it has just moved; gone again after a moment. */}
				<span
					aria-hidden="true"
					className={clsx(
						'absolute -bottom-3 whitespace-nowrap text-[0.6875rem] font-bold leading-none tabular-nums transition-opacity duration-200',
						change ? 'opacity-100' : 'opacity-0',
						change > 0 ? 'b-accent-text' : 'text-ink-3',
					)}
				>
					{change > 0 ? `▲ ${change}` : change < 0 ? `▼ ${-change}` : ''}
				</span>
			</span>

			{onOpen ? (
				<button
					type="button"
					aria-haspopup="dialog"
					onClick={() => onOpen(track)}
					className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left transition-opacity duration-150 active:opacity-60"
				>
					{text}
				</button>
			) : (
				<div className="flex min-w-0 flex-1 items-center gap-3">{text}</div>
			)}

			<div className="flex flex-none items-center">
				{canVote ? (
					<button
						type="button"
						aria-pressed={track.myVote === 'up'}
						aria-label={track.title ? `${t('track.voteUp')}: ${track.title}` : t('track.voteUp')}
						onClick={() => onVote(track.id, 'up')}
						className={clsx(arrow, track.myVote === 'up' ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:bg-card hover:text-ink')}
					>
						{/* A vote given shows in the shape too, not in colour alone. */}
						<ArrowBigUp size={24} strokeWidth={1.75} fill={track.myVote === 'up' ? 'currentColor' : 'none'} />
					</button>
				) : null}
				<span className={clsx('min-w-7 flex-none whitespace-nowrap text-center font-semibold tabular-nums', track.myVote === 'up' ? 'b-accent-text' : 'text-ink', !canVote && 'pr-3')}>
					{/* Digits that roll, where a row can be seen; plain digits far down. */}
					{animated ? <NumberFlow value={score} locales={locale} format={{ numberingSystem: 'latn' }} /> : formatCount(score, language)}
				</span>
				{canVote ? (
					<button
						type="button"
						aria-pressed={track.myVote === 'down'}
						aria-label={track.title ? `${t('track.voteDown')}: ${track.title}` : t('track.voteDown')}
						onClick={() => onVote(track.id, 'down')}
						className={clsx(arrow, track.myVote === 'down' ? 'bg-ink text-page' : 'text-ink-2 hover:bg-card hover:text-ink')}
					>
						<ArrowBigDown size={24} strokeWidth={1.75} fill={track.myVote === 'down' ? 'currentColor' : 'none'} />
					</button>
				) : null}
			</div>
		</Motion.li>
	);
});

Row.propTypes = {
	track: PropTypes.object.isRequired,
	rank: PropTypes.number.isRequired,
	animated: PropTypes.bool,
	cover: PropTypes.shape({ src: PropTypes.string, allowed: PropTypes.bool }).isRequired,
	canVote: PropTypes.bool,
	onVote: PropTypes.func.isRequired,
	onOpen: PropTypes.func,
	locale: PropTypes.string,
};

/**
 * The titles that come next, in the order of their votes.
 * `coverOf(track)` says which picture a title has and whether it may load.
 */
export function Chart({ tracks, coverOf, canVote = true, onVote, onOpen, label, className }) {
	const { language } = Language.useLanguage();
	// Serbian is written in Latin script here.
	const locale = language === 'sr' ? 'sr-Latn' : language;
	return (
		// The browser may not hold on to one of these rows while it scrolls: it
		// would scroll the list along with a row that changes place.
		<ol aria-label={label} className={clsx('b-chart relative space-y-1 [overflow-anchor:none]', className)}>
			<AnimatePresence initial={false} mode="popLayout">
				{tracks.map((track, index) => (
					<Row
						key={track.id}
						track={track}
						rank={index + 1}
						animated={index < ANIMATED_ROWS}
						cover={coverOf(track)}
						canVote={canVote}
						onVote={onVote}
						onOpen={onOpen}
						locale={locale}
					/>
				))}
			</AnimatePresence>
		</ol>
	);
}

Chart.propTypes = {
	tracks: PropTypes.array.isRequired,
	coverOf: PropTypes.func.isRequired,
	canVote: PropTypes.bool,
	onVote: PropTypes.func.isRequired,
	onOpen: PropTypes.func,
	label: PropTypes.string,
	className: PropTypes.string,
};
