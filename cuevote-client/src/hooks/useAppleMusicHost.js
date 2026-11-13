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

	const loadedKeyRef = useRef(null);
	const durationSentForRef = useRef(null);
	const storefrontSentRef = useRef(null);
	const reloadedForSignInRef = useRef(false);

	const currentKey = currentTrack?.videoId || null;
	const currentKeyRef = useLatestRef(currentKey);
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
		loadedKeyRef.current = null;
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
			const key = currentKeyRef.current;
			const duration = music.currentPlaybackDuration;
			if (key && loadedKeyRef.current === key && durationSentForRef.current !== key && duration > 0) {
				durationSentForRef.current = key;
				sendRef.current({ type: 'UPDATE_DURATION', payload: Math.round(duration) });
			}
		};
		const onError = (event) => {
			const key = currentKeyRef.current;
			if (!key || loadedKeyRef.current !== key) return;
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
	}, [music, currentKeyRef, sendRef]);

	// Tell the server the host's country: guests' suggestions are looked up there.
	useEffect(() => {
		if (!music || status !== 'ready') return;
		const storefront = String(music.storefrontId || '').toLowerCase();
		if (/^[a-z]{2}$/.test(storefront) && storefrontSentRef.current !== storefront) {
			storefrontSentRef.current = storefront;
			sendRef.current({ type: 'APPLE_STOREFRONT', payload: storefront });
		}
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
	}, [music]);

	// Play whatever the server says is current, from the server's position.
	useEffect(() => {
		if (!canPlay) return undefined;
		const parsed = parseTrackKey(currentKey);
		if (!parsed || parsed.provider !== 'apple') {
			if (loadedKeyRef.current) {
				loadedKeyRef.current = null;
				try { music.stop(); } catch { /* nothing loaded */ }
			}
			return undefined;
		}
		if (loadedKeyRef.current === currentKey) return undefined;
		loadedKeyRef.current = currentKey;
		durationSentForRef.current = null;
		let cancelled = false;
		(async () => {
			try {
				const startTime = Math.max(0, Math.floor(progressRef.current || 0));
				await music.setQueue({ [parsed.kind]: parsed.id, startPlaying: false, startTime });
				if (cancelled) return;
				if (isPlayingRef.current) await play();
			} catch (err) {
				if (cancelled) return;
				const code = errorCodeOf(err);
				setProblem({ code, message: describeMusicKitError(err) });
				sendRef.current({ type: 'PLAYBACK_ERROR', payload: { videoId: currentKey, errorCode: code } });
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [canPlay, currentKey, music, play, progressRef, isPlayingRef, sendRef]);

	// Follow the server's play/pause.
	useEffect(() => {
		if (!canPlay || !loadedKeyRef.current) return;
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
			if (!isPlayingRef.current || !loadedKeyRef.current) return;
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
		play().then(() => setStatus('ready')).catch((err) => {
			setProblem({ code: errorCodeOf(err), message: describeMusicKitError(err) });
		});
	}, [play]);

	const seek = useCallback((seconds) => {
		if (!canPlay) return;
		Promise.resolve(music.seekToTime(seconds)).catch(() => { /* drift check corrects it */ });
	}, [canPlay, music]);

	const getDuration = useCallback(() => (music?.currentPlaybackDuration || 0), [music]);

	return { status, problem, connect, start, seek, getDuration };
}
