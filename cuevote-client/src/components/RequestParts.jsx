// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// The parts a request for the host is made of (PendingRequests.jsx): what was
// suggested and by whom, and the buttons that decide about it.
import React from 'react';
import PropTypes from 'prop-types';
import { UserRound } from 'lucide-react';
import { suggesterLabel } from "../utils/participation";
import { isAppleKey } from "../utils/trackKeys";
import { CoverImage } from "./CoverImage";

const buildThumbnailUrl = (videoId) => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
// Apple Music artwork may appear with playback or playlists, and reviewing what
// enters the queue is managing the playlist. Apple items have no YouTube
// thumbnail to fall back to.
const artworkFor = (track) => track.thumbnail ?? (isAppleKey(track.videoId) ? null : buildThumbnailUrl(track.videoId));
const youTubeFallback = (track) => (isAppleKey(track.videoId) ? undefined : buildThumbnailUrl(track.videoId));

// One thing the host can do with a request: a round button with a line icon.
// Accepting is the one that stands out, in orange; the others stay quiet and
// turn red only under the pointer. A fingertip gets 44 px through cv-hit.
const ACTION_TONES = {
	accept: 'border-accent/50 bg-accent/10 text-accent hover:bg-accent/20',
	quiet: 'border-line text-ink-2 hover:bg-raised hover:text-ink',
	danger: 'border-line text-ink-2 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400',
};

export function RequestAction({ icon, label, tone = 'quiet', onClick, withLabel = false }) {
	const Icon = icon;
	return (
		<button
			type="button"
			onClick={onClick}
			title={label}
			aria-label={label}
			className={`cv-hit flex h-9 flex-none items-center justify-center gap-1.5 rounded-full border text-[13px] font-medium transition-[background-color,border-color,color,transform] duration-150 ease-cv active:scale-95 ${withLabel ? 'px-3.5' : 'w-9'} ${ACTION_TONES[tone]}`}
		>
			<Icon size={16} aria-hidden="true" />
			{withLabel && <span>{label}</span>}
		</button>
	);
}

RequestAction.propTypes = {
	icon: PropTypes.elementType.isRequired,
	label: PropTypes.string.isRequired,
	tone: PropTypes.oneOf(['accept', 'quiet', 'danger']),
	onClick: PropTypes.func,
	withLabel: PropTypes.bool,
};

// The cover, the title over the artist, and who suggested it: a request reads
// like a row of the playlist.
export function RequestSummary({ track, t, coverClass }) {
	const suggester = suggesterLabel(track, t) || t('pending.unknown');
	return (
		<>
			{artworkFor(track) ? (
				<CoverImage
					src={artworkFor(track)}
					fallbackSrc={youTubeFallback(track)}
					alt={track.title}
					className={`${coverClass} flex-shrink-0 rounded-lg`}
				/>
			) : (
				<div className={`${coverClass} flex-shrink-0 rounded-lg bg-raised`} aria-hidden="true" />
			)}
			<div className="min-w-0 flex-1">
				<p dir="auto" className="cv-bidi line-clamp-2 break-words text-[15px] font-medium leading-5 text-ink" title={track.title}>{track.title}</p>
				<p dir="auto" className="cv-bidi truncate text-[13px] leading-5 text-ink-2">{track.artist}</p>
				<p className="flex min-w-0 items-center gap-1 text-xs leading-5 text-ink-3">
					<UserRound size={12} className="flex-none" aria-hidden="true" />
					<span dir="auto" className="cv-bidi truncate">{suggester}</span>
				</p>
			</div>
		</>
	);
}

RequestSummary.propTypes = {
	track: PropTypes.object.isRequired,
	t: PropTypes.func.isRequired,
	coverClass: PropTypes.string.isRequired,
};
