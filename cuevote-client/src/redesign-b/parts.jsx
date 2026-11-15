// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// Design proposal B ("Neu"), DEV previews only: the pieces the lobby and the
// room share. The chart row is the draft's centre: a place number, the title,
// and the vote that moves it.
import React from 'react';
import PropTypes from 'prop-types';
import { ArrowBigUp, ArrowBigDown, Music2 } from 'lucide-react';
import '@fontsource-variable/sofia-sans/wght.css';
import '@fontsource-variable/sofia-sans-extra-condensed/wght.css';
import './b.css';
import { Consent } from '../contexts/ConsentContext';
import { isAppleKey } from '../utils/trackKeys';

export function Wordmark({ className = '' }) {
	return <span className={`b-display select-none text-accent ${className}`}>CueVote</span>;
}

Wordmark.propTypes = { className: PropTypes.string };

/**
 * A cover or thumbnail. Like everywhere in the app it shows only once the
 * visitor has agreed to load pictures from that source; until then, and when
 * a picture fails, its place holds a note. `local`: a picture drawn by the
 * page itself (the example chart), which loads nothing from anyone.
 */
export function Cover({ track, className = '', local = false }) {
	const { hasConsent, hasAppleConsent } = Consent.useConsent();
	const [failed, setFailed] = React.useState(false);
	const allowed = local || (isAppleKey(track?.videoId) ? hasAppleConsent : hasConsent);
	const src = allowed && !failed ? track?.thumbnail : null;
	return (
		<span className={`relative flex flex-none items-center justify-center overflow-hidden bg-raised text-ink-3 ${className}`}>
			{src
				? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
				: <Music2 size={18} aria-hidden="true" />}
		</span>
	);
}

Cover.propTypes = { track: PropTypes.object, className: PropTypes.string, local: PropTypes.bool };

/** Up, the count, down. The arrow of a vote already given is filled. */
export function VoteControl({ score, vote, onVote, labels, disabled = false }) {
	const button = 'flex h-10 w-9 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 ease-cv active:scale-90 disabled:opacity-40 sm:w-10';
	return (
		<div className="flex flex-none items-center rounded-full bg-card" onClick={(event) => event.stopPropagation()}>
			<button
				type="button"
				disabled={disabled}
				aria-label={labels.up}
				aria-pressed={vote === 'up'}
				onClick={() => onVote('up')}
				className={`${button} ${vote === 'up' ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:bg-raised hover:text-ink'}`}
			>
				<ArrowBigUp size={22} strokeWidth={1.75} fill={vote === 'up' ? 'currentColor' : 'none'} />
			</button>
			<span className="b-display min-w-[1.5rem] text-center text-[26px] leading-none tabular-nums text-ink sm:min-w-[1.75rem]" aria-live="polite">
				<span key={score} className="b-tick">{score}</span>
			</span>
			<button
				type="button"
				disabled={disabled}
				aria-label={labels.down}
				aria-pressed={vote === 'down'}
				onClick={() => onVote('down')}
				className={`${button} ${vote === 'down' ? 'bg-ink text-page' : 'text-ink-2 hover:bg-raised hover:text-ink'}`}
			>
				<ArrowBigDown size={22} strokeWidth={1.75} fill={vote === 'down' ? 'currentColor' : 'none'} />
			</button>
		</div>
	);
}

VoteControl.propTypes = {
	score: PropTypes.number.isRequired,
	vote: PropTypes.string,
	onVote: PropTypes.func.isRequired,
	labels: PropTypes.shape({ up: PropTypes.string, down: PropTypes.string }).isRequired,
	disabled: PropTypes.bool,
};

/** Who wished for a title: a small initial and the name. */
export function Wisher({ name, className = '' }) {
	// A guest is "Gast K7QF": the tag tells guests apart, so it leads.
	const words = name.split(' ');
	const short = words.length > 1 && /^[A-Z0-9]{4}$/.test(words[words.length - 1]) ? words[words.length - 1] : name;
	return (
		<span className={`flex min-w-0 flex-none items-center gap-1 text-ink-3 ${className}`} title={name}>
			<span className="flex h-4 w-4 flex-none items-center justify-center rounded-full bg-raised text-[10px] font-bold leading-none text-ink-2" aria-hidden="true">
				{name.trim().charAt(0).toUpperCase()}
			</span>
			<span className="max-w-[6rem] truncate">{short}</span>
		</span>
	);
}

Wisher.propTypes = { name: PropTypes.string.isRequired, className: PropTypes.string };

/**
 * One place of the chart: its number, the cover, the title over the artist
 * and who wished for it, and the vote. `data-flip` lets the row glide when
 * the order changes (useFlip).
 */
export function ChartRow({ place, track, vote, onVote, labels, suggester, votable = true, dense = false, localCover = false }) {
	return (
		<li
			data-flip={track.id}
			className={`relative flex items-center gap-2.5 border-b border-ink/10 bg-page sm:gap-3 ${dense ? 'py-2' : 'py-2.5'}`}
		>
			<span className={`b-display w-7 flex-none text-center text-[34px] tabular-nums sm:w-8 ${place === 1 ? 'text-ink' : 'text-ink-3'}`}>
				{place}
			</span>
			<Cover track={track} local={localCover} className="h-12 w-12 rounded-[10px]" />
			<div className="min-w-0 flex-1">
				<p className="truncate text-[16px] font-semibold leading-5 text-ink">{track.title}</p>
				<p className="mt-0.5 flex min-w-0 items-center gap-2 text-[13px] leading-5 text-ink-2">
					<span className="truncate">{track.artist}</span>
					{suggester ? <Wisher name={suggester} /> : null}
				</p>
			</div>
			{votable && (
				<VoteControl score={track.score || 0} vote={vote} onVote={(type) => onVote(track.id, type)} labels={labels} />
			)}
		</li>
	);
}

ChartRow.propTypes = {
	place: PropTypes.number.isRequired,
	track: PropTypes.object.isRequired,
	vote: PropTypes.string,
	onVote: PropTypes.func,
	labels: PropTypes.object,
	suggester: PropTypes.string,
	votable: PropTypes.bool,
	dense: PropTypes.bool,
	localCover: PropTypes.bool,
};

/** The draft's buttons: the orange one, the dark one, the quiet one. */
export function BButton({ kind = 'quiet', size = 'md', className = '', children, ...props }) {
	const kinds = {
		accent: 'bg-accent text-accent-ink hover:bg-[#ff6f1f]',
		dark: 'bg-ink text-page hover:bg-ink-2',
		quiet: 'bg-card text-ink hover:bg-raised',
		ghost: 'text-ink hover:bg-card',
	};
	const sizes = {
		sm: 'h-9 px-3.5 text-[14px]',
		md: 'h-11 px-5 text-[15px]',
		lg: 'h-[52px] px-7 text-[17px]',
	};
	return (
		<button
			type="button"
			{...props}
			className={`inline-flex flex-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-[background-color,color,transform,opacity] duration-150 ease-cv active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${kinds[kind]} ${sizes[size]} ${className}`}
		>
			{children}
		</button>
	);
}

BButton.propTypes = {
	kind: PropTypes.oneOf(['accent', 'dark', 'quiet', 'ghost']),
	size: PropTypes.oneOf(['sm', 'md', 'lg']),
	className: PropTypes.string,
	children: PropTypes.node,
};
