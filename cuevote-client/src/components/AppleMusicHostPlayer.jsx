// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { CircleAlert, CloudOff, Link2, ListMusic, Loader2, MonitorSmartphone, Play, RotateCw } from "lucide-react";
import { Language } from "../contexts/LanguageContext";
import { useLatestRef } from "../hooks/useLatestRef";
import { parseTrackKey } from "../utils/trackKeys";
import { StatusButton, StatusCard, StatusLine } from "./PlayerStatus";

// Problems the host can do something about, by MusicKit error code.
const SUBSCRIPTION_CODES = new Set(['SUBSCRIPTION_ERROR', 'STREAM_UPSELL']);
const OTHER_DEVICE_CODES = new Set(['DEVICE_LIMIT', 'CONCURRENT_STREAMS', 'STREAM_LIMIT']);

// A problem shows after this wait, see useShownProblem.
const PROBLEM_DELAY_MS = 400;
// "Try again" stays busy this long at most; the player's answer ends it earlier.
const RETRY_WAIT_MS = 12000;

/**
 * The playback problem to show, if any. A problem belongs to the track it came
 * up on: the server skips an item that cannot be played and the next one loads
 * at once, so a message would only flicker. It shows after a short wait, and
 * only while the room is still on that track.
 */
function useShownProblem(problem, entryId) {
	const [shown, setShown] = useState(null); // { code, entry }
	const entryRef = useLatestRef(entryId);
	const shownRef = useLatestRef(shown);

	useEffect(() => {
		if (!problem) {
			setShown(null);
			return undefined;
		}
		const entry = entryRef.current;
		// Reported again for the same track (the server confirms what the
		// player said, a retry failed the same way): it stays up.
		const up = shownRef.current;
		if (up && up.code === problem.code && up.entry === entry) return undefined;
		const timer = setTimeout(() => setShown({ code: problem.code, entry }), PROBLEM_DELAY_MS);
		return () => clearTimeout(timer);
	}, [problem, entryRef, shownRef]);

	return problem && shown && shown.code === problem.code && shown.entry === entryId ? problem : null;
}

/**
 * The host's Apple Music player. MusicKit renders music videos into the element
 * with the id "apple-music-video-container"; a song shows its artwork instead,
 * which Apple allows only next to playback.
 *
 * Whatever keeps it from playing is shown over the dimmed picture: a card
 * with the next step when the host has something to do, a quiet line when not.
 */
export function AppleMusicHostPlayer({ apple, currentTrack, onRetry }) {
	const { t } = Language.useLanguage();
	const parsed = parseTrackKey(currentTrack?.videoId);
	const isSong = parsed?.provider === 'apple' && parsed.kind === 'song';
	const { status, connect, start, claim, disconnect } = apple;
	const problem = useShownProblem(apple.problem, currentTrack?.id);

	// A card says what the host can do. MusicKit's code says what went wrong to
	// whoever looks into it: that goes to the console, not onto the card.
	useEffect(() => {
		if (apple.problem?.code) console.warn('[Apple Music]', apple.problem.code, apple.problem.message || '');
	}, [apple.problem]);

	// "Try again" is answered by the player: it plays (the problem goes) or
	// fails again (a new problem comes).
	const [retrying, setRetrying] = useState(false);
	useEffect(() => {
		setRetrying(false);
	}, [apple.problem]);
	useEffect(() => {
		if (!retrying) return undefined;
		const timer = setTimeout(() => setRetrying(false), RETRY_WAIT_MS);
		return () => clearTimeout(timer);
	}, [retrying]);
	const retry = () => {
		setRetrying(true);
		onRetry?.();
	};

	let card = null;
	let line = null;
	if (status === 'standby') {
		// Another owner device plays the room: Apple streams one at a time.
		card = (
			<StatusCard icon={MonitorSmartphone} title={t('appleMusic.standby')}>
				<StatusButton icon={Play} onClick={claim}>{t('appleMusic.playHere')}</StatusButton>
			</StatusCard>
		);
	} else if (status === 'loading' || status === 'off') {
		line = <StatusLine icon={Loader2} spin>{t('appleMusic.loading')}</StatusLine>;
	} else if (status === 'error') {
		card = (
			<StatusCard icon={CloudOff} tone="attention" title={t('appleMusic.loadFailed')}>
				<StatusButton icon={RotateCw} onClick={() => window.location.reload()}>{t('player.ipBlockRetry')}</StatusButton>
			</StatusCard>
		);
	} else if (status === 'signed-out') {
		// A sign-in that failed says so; one the host closed says nothing.
		const failed = !!apple.problem?.signIn;
		card = (
			<StatusCard
				icon={Link2}
				title={failed ? t('appleMusic.signInFailed') : undefined}
				text={t('appleMusic.connectHint')}
			>
				<StatusButton onClick={connect}>{t('appleMusic.connect')}</StatusButton>
			</StatusCard>
		);
	} else if (status === 'needs-start') {
		card = (
			<StatusCard icon={Play} text={t('appleMusic.startHint')}>
				<StatusButton onClick={start}>{t('appleMusic.start')}</StatusButton>
			</StatusCard>
		);
	} else if (problem && OTHER_DEVICE_CODES.has(problem.code)) {
		card = (
			<StatusCard icon={MonitorSmartphone} tone="attention" title={t('appleMusic.problemOtherDevice')}>
				<StatusButton icon={Play} busy={retrying} onClick={retry}>{t('appleMusic.playHere')}</StatusButton>
			</StatusCard>
		);
	} else if (problem && SUBSCRIPTION_CODES.has(problem.code)) {
		card = (
			<StatusCard icon={CircleAlert} tone="attention" title={t('appleMusic.problemSubscription')}>
				<StatusButton icon={RotateCw} busy={retrying} onClick={retry}>{t('app.retryPlayback')}</StatusButton>
				{disconnect && (
					<StatusButton variant="secondary" onClick={disconnect}>{t('appleMusic.switchAccount')}</StatusButton>
				)}
			</StatusCard>
		);
	} else if (problem) {
		card = (
			<StatusCard icon={CircleAlert} tone="attention" title={t('appleMusic.problemGeneric')}>
				<StatusButton icon={RotateCw} busy={retrying} onClick={retry}>{t('app.retryPlayback')}</StatusButton>
			</StatusCard>
		);
	} else if (!currentTrack) {
		line = <StatusLine icon={ListMusic}>{t('playlist.queueEmpty')}</StatusLine>;
	}

	return (
		<div className="relative h-full w-full overflow-hidden bg-black">
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
			{(card || line) && (
				<div
					role="status"
					className="absolute inset-0 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md"
				>
					{card || line}
				</div>
			)}
		</div>
	);
}

AppleMusicHostPlayer.propTypes = {
	apple: PropTypes.shape({
		status: PropTypes.string.isRequired,
		problem: PropTypes.shape({ code: PropTypes.string, message: PropTypes.string, signIn: PropTypes.bool }),
		connect: PropTypes.func.isRequired,
		start: PropTypes.func.isRequired,
		claim: PropTypes.func.isRequired,
		disconnect: PropTypes.func,
	}).isRequired,
	currentTrack: PropTypes.object,
	// "Try again" on a playback problem: asks the room to play again.
	onRetry: PropTypes.func,
};
