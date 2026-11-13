// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLatestRef } from './useLatestRef';
import { configureMusicKit, describeMusicKitError, fetchDeveloperToken } from '../utils/musicKit';
import { parseTrackKey } from '../utils/trackKeys';

// The Apple Music player of an Apple room. MusicKit plays on one signed-in
// subscriber's device, so only the owner's browser plays; everyone else gets the
// playlist view. Like the YouTube player it follows the server: the server's
// current track, the server's position, the server's play/pause. The server
// stays the clock and advances the queue; this only plays what it says.
//
// status: off | loading | signed-out | ready | needs-start | error

const DRIFT_CHECK_MS = 5000;
const MAX_DRIFT_S = 3;
const SIGN_IN_POLL_MS = 2000;
const START_CHECK_MS = 3000;

// MusicKit keeps the signed-in user's token here (key: music.<id>.media-user-token).
const STORED_USER_TOKEN = /^music\.[^.]+\.media-user-token$/;

function hasStoredUserToken() {
	try {
		return Object.keys(window.localStorage).some(key => STORED_USER_TOKEN.test(key));
	} catch {
		return false;
	}
}

function errorCodeOf(err) {
	return String(err?.errorCode || err?.code || (err?.name && err.name !== 'Error' ? err.name : '') || 'UNKNOWN_ERROR').slice(0, 60);
}

// Browsers refuse play() without a recent click on the page; MusicKit says so
// with its own code. Neither is a playback error, the host just has to tap.
function isAutoplayRefusal(err) {
	const code = errorCodeOf(err);
	return code === 'NotAllowedError' || code === 'USER_INTERACTION_REQUIRED';
}

export function useAppleMusicHost({ enabled, currentTrack, isPlaying, progressRef, sendMessage }) {
	const [music, setMusic] = useState(null);
	const [status, setStatus] = useState('off');
	const [problem, setProblem] = useState(null);
	const [awaitingSignIn, setAwaitingSignIn] = useState(false);

	// What is loaded is tracked per queue entry, not per track key: the same
	// song can come back as a new entry (Auto-DJ, a repeat request) and must
	// then start again from the server's position.
	const loadedEntryRef = useRef(null);
	const durationSentForRef = useRef(null);
	const storefrontSentRef = useRef(null);
	const reloadedForSignInRef = useRef(false);

	const currentKey = currentTrack?.videoId || null;
	const currentEntry = currentTrack ? `${currentTrack.id || ''}|${currentKey}` : null;
	const currentKeyRef = useLatestRef(currentKey);
	const currentEntryRef = useLatestRef(currentEntry);
	const isPlayingRef = useLatestRef(isPlaying);
	const sendRef = useLatestRef(sendMessage);

	const canPlay = !!music && (status === 'ready' || status === 'needs-start');

	// Load MusicKit from Apple's CDN and configure it with the server's token.
	useEffect(() => {
		if (!enabled) {
			setStatus('off');
			return undefined;
		}
		let cancelled = false;
		setStatus('loading');
		setProblem(null);
		(async () => {
			try {
				const { token } = await fetchDeveloperToken();
				const instance = await configureMusicKit({ developerToken: token });
				if (cancelled) return;
				// The server decides what plays next. MusicKit must not continue
				// with Apple's own picks once its one-item queue has ended.
				if (instance.autoplayEnabled) instance.autoplayEnabled = false;
				// The page may have previewed as a guest before signing in as the
				// owner (useApplePreview): the room plays full songs.
				if (instance.previewOnly) instance.previewOnly = false;
				setMusic(instance);
				setStatus(instance.isAuthorized ? 'ready' : 'signed-out');
			} catch (err) {
				if (cancelled) return;
				setProblem({ code: errorCodeOf(err), message: describeMusicKitError(err) });
				setStatus('error');
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [enabled]);

	// Leaving the room (or losing ownership) must not leave Apple Music playing.
	useEffect(() => {
		if (!music || enabled) return undefined;
		loadedEntryRef.current = null;
		try { music.stop(); } catch { /* nothing loaded */ }
		return undefined;
	}, [music, enabled]);
	useEffect(() => () => {
		try { music?.stop(); } catch { /* nothing loaded */ }
	}, [music]);

	// MusicKit events: sign-in changes, playback start (report the real
	// duration once per track), playback errors (the server decides: skip or
	// pause).
	useEffect(() => {
		if (!music) return undefined;
		const playing = window.MusicKit?.PlaybackStates?.playing;
		const onAuthorization = () => {
			setStatus(prev => {
				if (!music.isAuthorized) return 'signed-out';
				return prev === 'signed-out' ? 'ready' : prev;
			});
		};
		const onPlaybackState = () => {
			if (music.playbackState !== playing) return;
			setStatus(prev => (prev === 'needs-start' ? 'ready' : prev));
			setProblem(null);
			const entry = currentEntryRef.current;
			const duration = music.currentPlaybackDuration;
			if (entry && loadedEntryRef.current === entry && durationSentForRef.current !== entry && duration > 0) {
				durationSentForRef.current = entry;
				sendRef.current({ type: 'UPDATE_DURATION', payload: Math.round(duration) });
			}
		};
		const onError = (event) => {
			const key = currentKeyRef.current;
			if (!key || loadedEntryRef.current !== currentEntryRef.current) return;
			const code = errorCodeOf(event?.error || event);
			setProblem({ code });
			sendRef.current({ type: 'PLAYBACK_ERROR', payload: { videoId: key, errorCode: code } });
		};
		music.addEventListener('authorizationStatusDidChange', onAuthorization);
		music.addEventListener('playbackStateDidChange', onPlaybackState);
		music.addEventListener('mediaPlaybackError', onError);
		return () => {
			music.removeEventListener('authorizationStatusDidChange', onAuthorization);
			music.removeEventListener('playbackStateDidChange', onPlaybackState);
			music.removeEventListener('mediaPlaybackError', onError);
		};
	}, [music, currentKeyRef, currentEntryRef, sendRef]);

	// Tell the server the host's country: guests' suggestions are looked up there.
	// Right after signing in MusicKit still reports its default storefront (us)
	// and learns the account's own a moment later (13.11.2026), so every change
	// is passed on, not only the first value.
	useEffect(() => {
		if (!music || status !== 'ready') return undefined;
		const report = () => {
			const storefront = String(music.storefrontId || '').toLowerCase();
			if (/^[a-z]{2}$/.test(storefront) && storefrontSentRef.current !== storefront) {
				storefrontSentRef.current = storefront;
				sendRef.current({ type: 'APPLE_STOREFRONT', payload: storefront });
			}
		};
		report();
		music.addEventListener('storefrontIdentifierDidChange', report);
		music.addEventListener('storefrontCountryCodeDidChange', report);
		return () => {
			music.removeEventListener('storefrontIdentifierDidChange', report);
			music.removeEventListener('storefrontCountryCodeDidChange', report);
		};
	}, [music, status, sendRef]);

	const play = useCallback(async () => {
		if (!music) return;
		try {
			await music.play();
		} catch (err) {
			if (isAutoplayRefusal(err)) {
				setStatus('needs-start');
				return;
			}
			throw err;
		}
		// After a page load Chrome refuses sound without a click, and MusicKit
		// resolves play() all the same (13.11.2026). Check that it really plays.
		await new Promise(resolve => setTimeout(resolve, START_CHECK_MS));
		if (isPlayingRef.current && music.playbackState !== window.MusicKit?.PlaybackStates?.playing) {
			setStatus('needs-start');
		}
	}, [music, isPlayingRef]);

	// Play whatever the server says is current, from the server's position.
	useEffect(() => {
		if (!canPlay) return undefined;
		const parsed = parseTrackKey(currentKey);
		if (!parsed || parsed.provider !== 'apple') {
			if (loadedEntryRef.current) {
				loadedEntryRef.current = null;
				try { music.stop(); } catch { /* nothing loaded */ }
			}
			return undefined;
		}
		if (loadedEntryRef.current === currentEntry) return undefined;
		loadedEntryRef.current = currentEntry;
		durationSentForRef.current = null;
		let cancelled = false;
		let finished = false;
		(async () => {
			try {
				const startTime = Math.max(0, Math.floor(progressRef.current || 0));
				await music.setQueue({ [parsed.kind]: parsed.id, startPlaying: false, startTime });
				if (cancelled) return;
				if (isPlayingRef.current) await play();
				finished = true;
			} catch (err) {
				if (cancelled) return;
				finished = true;
				const code = errorCodeOf(err);
				setProblem({ code, message: describeMusicKitError(err) });
				sendRef.current({ type: 'PLAYBACK_ERROR', payload: { videoId: currentKey, errorCode: code } });
			}
		})();
		return () => {
			cancelled = true;
			// A load cut short (React's second effect run in development, a
			// quick track change) has to be redone, not skipped as loaded.
			if (!finished && loadedEntryRef.current === currentEntry) loadedEntryRef.current = null;
		};
	}, [canPlay, currentKey, currentEntry, music, play, progressRef, isPlayingRef, sendRef]);

	// Follow the server's play/pause.
	useEffect(() => {
		if (!canPlay || !loadedEntryRef.current) return;
		const playing = window.MusicKit?.PlaybackStates?.playing;
		if (isPlaying) {
			if (music.playbackState !== playing) play().catch(() => { /* reported by the error event */ });
		} else {
			try { music.pause(); } catch { /* nothing loaded */ }
		}
	}, [canPlay, isPlaying, music, play]);

	// Keep within a few seconds of the server's position.
	useEffect(() => {
		if (!canPlay) return undefined;
		const timer = setInterval(() => {
			if (!isPlayingRef.current || !loadedEntryRef.current) return;
			if (music.playbackState !== window.MusicKit?.PlaybackStates?.playing) return;
			const expected = progressRef.current || 0;
			const duration = music.currentPlaybackDuration || 0;
			if (duration && expected > duration - 2) return;
			if (Math.abs((music.currentPlaybackTime || 0) - expected) > MAX_DRIFT_S) {
				Promise.resolve(music.seekToTime(expected)).catch(() => { /* next check tries again */ });
			}
		}, DRIFT_CHECK_MS);
		return () => clearInterval(timer);
	}, [canPlay, music, progressRef, isPlayingRef]);

	// Sign-in opens Apple's window. Its answer does not always reach this page
	// (Chrome, 13.11.2026), although MusicKit has stored the user token: then a
	// reload picks the sign-in up.
	const connect = useCallback(() => {
		if (!music) return;
		setProblem(null);
		setAwaitingSignIn(true);
		music.authorize().then(() => {
			if (music.isAuthorized) setStatus('ready');
		}).catch((err) => {
			setProblem({ code: errorCodeOf(err), message: describeMusicKitError(err) });
		});
	}, [music]);

	useEffect(() => {
		if (!awaitingSignIn || !music) return undefined;
		const timer = setInterval(() => {
			if (music.isAuthorized) {
				setAwaitingSignIn(false);
				setStatus('ready');
				return;
			}
			if (hasStoredUserToken() && !reloadedForSignInRef.current) {
				reloadedForSignInRef.current = true;
				window.location.reload();
			}
		}, SIGN_IN_POLL_MS);
		return () => clearInterval(timer);
	}, [awaitingSignIn, music]);

	// The host's tap, when the browser refused to start playback on its own.
	const start = useCallback(() => {
		// play() puts the button back if this attempt does not start either.
		setStatus('ready');
		play().catch((err) => {
			setProblem({ code: errorCodeOf(err), message: describeMusicKitError(err) });
		});
	}, [play]);

	const seek = useCallback((seconds) => {
		if (!canPlay) return;
		Promise.resolve(music.seekToTime(seconds)).catch(() => { /* drift check corrects it */ });
	}, [canPlay, music]);

	const getDuration = useCallback(() => (music?.currentPlaybackDuration || 0), [music]);

	// 0..1. A new identity once MusicKit is loaded, so callers apply it again.
	const setVolume = useCallback((level) => {
		if (!music) return;
		try {
			music.volume = Math.min(1, Math.max(0, Number(level) || 0));
		} catch { /* not ready yet */ }
	}, [music]);

	return { status, problem, connect, start, seek, getDuration, setVolume };
}
