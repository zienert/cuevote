// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React from 'react';
import PropTypes from 'prop-types';
import { Language } from '../contexts/LanguageContext';
import { parseTrackKey } from '../utils/trackKeys';
import { AppleContentNotice } from './AppleContentNotice';

/**
 * The window a guest previews an Apple Music item in. It stays mounted while
 * closed: MusicKit renders music videos into the element with the id
 * "apple-music-video-container", which must stay the same between previews.
 * A song shows its artwork instead, which Apple allows next to playback.
 * Without the guest's Apple consent it asks for it first.
 */
export function ApplePreviewOverlay({ track, preview, consent, onAccept, isCinemaMode }) {
	const { t } = Language.useLanguage();
	const open = !!track;
	const isSong = parseTrackKey(track?.videoId)?.kind === 'song';
	const paddingTop = isCinemaMode ? 'pt-4' : 'pt-20';
	const paddingBottom = isCinemaMode ? 'pb-20' : 'pb-24';

	let message = null;
	if (consent && preview.status === 'loading') {
		message = <p className="text-neutral-300">{t('appleMusic.loading')}</p>;
	} else if (consent && preview.status === 'error') {
		message = <p className="text-neutral-300">{t('appleMusic.previewFailed')}</p>;
	} else if (consent && preview.status === 'needs-start') {
		message = (
			<button
				type="button"
				onClick={preview.start}
				className="px-6 py-3 rounded-full bg-white text-black font-semibold hover:bg-neutral-200 transition-colors"
			>
				{t('appleMusic.start')}
			</button>
		);
	}

	return (
		<div className={open
			? `fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center ${paddingTop} ${paddingBottom} px-4 animate-fadeIn`
			: 'hidden'}
		>
			<div className="w-full max-w-5xl aspect-video max-h-full bg-black rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10 relative">
				{open && consent && isSong && track.thumbnail && (
					<img
						src={track.thumbnail}
						alt=""
						className="absolute inset-0 m-auto h-full max-h-full w-auto object-contain"
					/>
				)}
				<div
					id="apple-music-video-container"
					className="absolute inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-contain"
				/>
				{open && !consent && (
					<div className="absolute inset-0 flex items-center justify-center bg-black">
						<AppleContentNotice layout="card" onAccept={onAccept} />
					</div>
				)}
				{open && message && (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70 p-6 text-center">
						{message}
					</div>
				)}
			</div>
		</div>
	);
}

ApplePreviewOverlay.propTypes = {
	track: PropTypes.object,
	preview: PropTypes.shape({
		status: PropTypes.string.isRequired,
		start: PropTypes.func.isRequired,
	}).isRequired,
	consent: PropTypes.bool.isRequired,
	onAccept: PropTypes.func.isRequired,
	isCinemaMode: PropTypes.bool,
};
