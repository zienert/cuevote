// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React from "react";
import PropTypes from "prop-types";
import { Language } from "../contexts/LanguageContext";
import { parseTrackKey } from "../utils/trackKeys";

// Problems the host can do something about, by MusicKit error code.
const SUBSCRIPTION_CODES = new Set(['SUBSCRIPTION_ERROR', 'STREAM_UPSELL']);
const OTHER_DEVICE_CODES = new Set(['DEVICE_LIMIT', 'CONCURRENT_STREAMS', 'STREAM_LIMIT']);

function problemText(problem, t) {
	if (!problem) return null;
	if (SUBSCRIPTION_CODES.has(problem.code)) return t('appleMusic.problemSubscription');
	if (OTHER_DEVICE_CODES.has(problem.code)) return t('appleMusic.problemOtherDevice');
	return t('appleMusic.problemGeneric', { code: problem.code });
}

/**
 * The host's Apple Music player. MusicKit renders music videos into the element
 * with the id "apple-music-video-container"; a song shows its artwork instead,
 * which Apple allows only next to playback.
 */
export function AppleMusicHostPlayer({ apple, currentTrack }) {
	const { t } = Language.useLanguage();
	const parsed = parseTrackKey(currentTrack?.videoId);
	const isSong = parsed?.provider === 'apple' && parsed.kind === 'song';
	const { status, problem, connect, start, claim } = apple;

	let overlay = null;
	if (status === 'standby') {
		// Another owner device plays the room: Apple streams one at a time.
		overlay = (
			<>
				<p className="max-w-sm text-neutral-300">{t('appleMusic.standby')}</p>
				<button
					type="button"
					onClick={claim}
					className="px-6 py-3 rounded-full bg-white text-black font-semibold hover:bg-neutral-200 transition-colors"
				>
					{t('appleMusic.playHere')}
				</button>
			</>
		);
	} else if (status === 'loading' || status === 'off') {
		overlay = <p className="text-neutral-300">{t('appleMusic.loading')}</p>;
	} else if (status === 'error') {
		overlay = <p className="text-neutral-300">{t('appleMusic.loadFailed')}</p>;
	} else if (status === 'signed-out') {
		overlay = (
			<>
				<button
					type="button"
					onClick={connect}
					className="px-6 py-3 rounded-full bg-white text-black font-semibold hover:bg-neutral-200 transition-colors"
				>
					{t('appleMusic.connect')}
				</button>
				<p className="max-w-sm text-sm text-neutral-400">{t('appleMusic.connectHint')}</p>
			</>
		);
	} else if (status === 'needs-start') {
		overlay = (
			<button
				type="button"
				onClick={start}
				className="px-6 py-3 rounded-full bg-white text-black font-semibold hover:bg-neutral-200 transition-colors"
			>
				{t('appleMusic.start')}
			</button>
		);
	} else if (!currentTrack) {
		overlay = <p className="text-neutral-500">{t('playlist.queueEmpty')}</p>;
	}

	return (
		<div className="relative h-full w-full bg-black">
			{isSong && currentTrack?.thumbnail && (
				<img
					src={currentTrack.thumbnail}
					alt=""
					className="absolute inset-0 m-auto h-full max-h-full w-auto object-contain"
				/>
			)}
			<div
				id="apple-music-video-container"
				className="absolute inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-contain"
			/>
			{(overlay || problem) && (
				<div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70 p-6 text-center">
					{overlay}
					{problem && status !== 'error' && (
						<p className="max-w-sm text-sm text-amber-300">{problemText(problem, t)}</p>
					)}
				</div>
			)}
		</div>
	);
}

AppleMusicHostPlayer.propTypes = {
	apple: PropTypes.shape({
		status: PropTypes.string.isRequired,
		problem: PropTypes.shape({ code: PropTypes.string }),
		connect: PropTypes.func.isRequired,
		start: PropTypes.func.isRequired,
		claim: PropTypes.func.isRequired,
	}).isRequired,
	currentTrack: PropTypes.object,
};
