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
// One owner device plays the room at a time (`lease`, from the server): Apple
// streams one account on one device, and two players cut each other off.
// The others stand by and offer to take over. The player tells the server
// whether it can play (APPLE_PLAYER_STATUS); a room holds still while it
// cannot.
//
// status: off | loading | signed-out | ready | needs-start | standby | error

const DRIFT_CHECK_MS = 5000;
const MAX_DRIFT_S = 3;
const SIGN_IN_POLL_MS = 2000;
const START_CHECK_MS = 3000;
const STATUS_HEARTBEAT_MS = 10000;
// A page whose developer token runs out within this reloads at the next track
// change; MusicKit takes its token once, at configure (24 h, renewed by the
// server below 12 h).
const TOKEN_RENEW_BEFORE_MS = 60 * 60 * 1000;

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

// "<queue entry id>|<track key>": what is loaded is tracked per entry, not per
// key, since the same song can come back as a new entry.
function entryOf(track) {
	return track ? `${track.id || ''}|${track.videoId || ''}` : null;
}

function trackIdOf(entry) {
	const id = entry ? entry.split('|')[0] : '';
	return id || undefined;
}

export function useAppleMusicHost({ enabled, currentTrack, isPlaying, progressRef, progressAtRef, sendMessage, lease }) {
	const [music, setMusic] = useState(null);
	const [status, setStatus] = useState('off');
	const [problem, setProblem] = useState(null);
	const [awaitingSignIn, setAwaitingSignIn] = useState(false);

	// The entry a load was started for, and the entry MusicKit has queued (set
	// once setQueue succeeded and MusicKit holds the right item).
	const loadedEntryRef = useRef(null);
	const readyEntryRef = useRef(null);
	// Entries reloaded once because MusicKit played another item under them.
	const mismatchReloadedRef = useRef(null);
	const [reloadTick, setReloadTick] = useState(0);
	const durationSentForRef = useRef(null);
	// One report per failed load: MusicKit may both reject play() and fire
	// its error event for the same failure.
	const errorSentForRef = useRef(null);
	const storefrontSentRef = useRef(null);
	const reloadedForSignInRef = useRef(false);
	const tokenExpiresAtRef = useRef(0);
	// MusicKit calls run one after another: a cancelled load's setQueue must
	// not land after the next one's (14.11.2026).
	const chainRef = useRef(Promise.resolve());
	// Bumped whenever this player may no longer play (switched off, standby,
	// signed out): async work started before checks it after every await.
	const generationRef = useRef(0);

	const currentKey = currentTrack?.videoId || null;
	const currentEntry = entryOf(currentTrack);
	const currentKeyRef = useLatestRef(currentKey);
	const currentEntryRef = useLatestRef(currentEntry);
	const isPlayingRef = useLatestRef(isPlaying);
	const sendRef = useLatestRef(sendMessage);

	const isPlayer = lease === true;
	const canPlay = enabled && isPlayer && !!music && (status === 'ready' || status === 'needs-start');
	const canPlayRef = useLatestRef(canPlay);

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
				const { token, expiresAt } = await fetchDeveloperToken();
				const instance = await configureMusicKit({ developerToken: token });
				if (cancelled) return;
				tokenExpiresAtRef.current = Number(expiresAt) || 0; // ms
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

	// Stop and forget what is loaded whenever this device may not play: the
	// room left, ownership lost, another device playing, Apple signed out.
	// Without this, a player switched off a moment after a track started came
	// back on by itself, and MusicKit went on with the old item under a new
	// title after a sign-out.
	useEffect(() => {
		if (canPlay) return undefined;
		generationRef.current += 1;
		loadedEntryRef.current = null;
		readyEntryRef.current = null;
		if (music) {
			try { music.stop(); } catch { /* nothing loaded */ }
		}
		return undefined;
	}, [canPlay, music]);
	useEffect(() => () => {
		generationRef.current += 1;
		try { music?.stop(); } catch { /* nothing loaded */ }
	}, [music]);

	useEffect(() => {
		if (enabled && music && lease === false) setStatus(prev => (prev === 'ready' || prev === 'needs-start' ? 'standby' : prev));
		if (enabled && music && lease === true) setStatus(prev => (prev === 'standby' ? (music.isAuthorized ? 'ready' : 'signed-out') : prev));
	}, [enabled, music, lease]);

	// Whether MusicKit holds the room's current item. Before play its
	// nowPlayingItem is unset; the queue then says what it will play.
	const holdsCurrentItem = useCallback(() => {
		const expected = parseTrackKey(currentKeyRef.current)?.id;
		const item = music?.nowPlayingItem || music?.queue?.items?.[0];
		return !!expected && !!item && String(item.id) === String(expected);
	}, [music, currentKeyRef]);

	// MusicKit events: sign-in changes, playback start (report the real
	// duration once per track), playback errors (the server decides: skip or
	// pause), the item changing under the room's track.
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
			if (entry && readyEntryRef.current === entry && durationSentForRef.current !== entry && duration > 0 && holdsCurrentItem()) {
				durationSentForRef.current = entry;
				sendRef.current({ type: 'UPDATE_DURATION', payload: { duration: Math.round(duration), trackId: trackIdOf(entry) } });
			}
		};
		const onError = (event) => {
			const err = event?.error || event;
			if (isAutoplayRefusal(err)) {
				setStatus(prev => (prev === 'ready' ? 'needs-start' : prev));
				return;
			}
			// Only for the entry MusicKit has queued, and while it holds that
			// entry's item: an error of an item it was told to drop belongs to
			// no current track (it paused or skipped the next one, 14.11.2026).
			const entry = currentEntryRef.current;
			if (!canPlayRef.current || !entry || readyEntryRef.current !== entry || !holdsCurrentItem()) return;
			if (errorSentForRef.current === entry) return;
			errorSentForRef.current = entry;
			const code = errorCodeOf(err);
			setProblem({ code });
			sendRef.current({ type: 'PLAYBACK_ERROR', payload: { videoId: currentKeyRef.current, errorCode: code, trackId: trackIdOf(entry) } });
			// Loaded afresh if the server plays this entry again.
			loadedEntryRef.current = null;
			readyEntryRef.current = null;
		};
		const onItemChange = () => {
			const entry = currentEntryRef.current;
			if (!canPlayRef.current || !entry || readyEntryRef.current !== entry || !music.nowPlayingItem) return;
			if (holdsCurrentItem() || mismatchReloadedRef.current === entry) return;
			mismatchReloadedRef.current = entry;
			loadedEntryRef.current = null;
			readyEntryRef.current = null;
			try { music.stop(); } catch { /* nothing playing */ }
			setReloadTick(tick => tick + 1);
		};
		music.addEventListener('authorizationStatusDidChange', onAuthorization);
		music.addEventListener('playbackStateDidChange', onPlaybackState);
		music.addEventListener('mediaPlaybackError', onError);
		music.addEventListener('nowPlayingItemDidChange', onItemChange);
		return () => {
			music.removeEventListener('authorizationStatusDidChange', onAuthorization);
			music.removeEventListener('playbackStateDidChange', onPlaybackState);
			music.removeEventListener('mediaPlaybackError', onError);
			music.removeEventListener('nowPlayingItemDidChange', onItemChange);
		};
	}, [music, currentKeyRef, currentEntryRef, sendRef, canPlayRef, holdsCurrentItem]);

	// Tell the server the host's country: guests' suggestions are looked up there.
	// MusicKit's storefrontId starts as its default (us) and learns the
	// account's own only later; on 13.11.2026 suggestions were resolved in the
	// US catalog meanwhile and could not be played in NL. So the account is
	// asked directly, and only its answer is passed on. Only the room's player
	// reports it.
	useEffect(() => {
		if (!music || status !== 'ready' || !isPlayer) return undefined;
		let cancelled = false;
		const report = async () => {
			if (!music.isAuthorized) return;
			let storefront = '';
			try {
				const response = await music.api.music('/v1/me/storefront');
				storefront = String(response?.data?.data?.[0]?.id || '').toLowerCase();
			} catch {
				return; // asked again on the next change
			}
			if (cancelled || !/^[a-z]{2}$/.test(storefront) || storefrontSentRef.current === storefront) return;
			storefrontSentRef.current = storefront;
			sendRef.current({ type: 'APPLE_STOREFRONT', payload: storefront });
		};
		report();
		music.addEventListener('storefrontCountryCodeDidChange', report);
		music.addEventListener('authorizationStatusDidChange', report);
		return () => {
			cancelled = true;
			music.removeEventListener('storefrontCountryCodeDidChange', report);
			music.removeEventListener('authorizationStatusDidChange', report);
		};
	}, [music, status, isPlayer, sendRef]);

	// Tell the server whether this device can play, now and every few
	// seconds: the room holds still while no player can (Room.followApplePlayer).
	useEffect(() => {
		if (!enabled) return undefined;
		const report = () => {
			let state = 'blocked';
			if (lease === false) state = 'standby';
			else if (status === 'ready' && music) {
				state = music.playbackState === window.MusicKit?.PlaybackStates?.playing ? 'playing' : 'ready';
			}
			sendRef.current({ type: 'APPLE_PLAYER_STATUS', payload: { state } });
		};
		report();
		const timer = setInterval(report, STATUS_HEARTBEAT_MS);
		return () => clearInterval(timer);
	}, [enabled, lease, status, music, sendRef]);

	const play = useCallback(async () => {
		if (!music) return;
		const generation = generationRef.current;
		try {
			await music.play();
		} catch (err) {
			if (generation !== generationRef.current) return;
			if (isAutoplayRefusal(err)) {
				setStatus(prev => (prev === 'ready' ? 'needs-start' : prev));
				return;
			}
			throw err;
		}
		// After a page load Chrome refuses sound without a click, and MusicKit
		// resolves play() all the same (13.11.2026). Check that it really plays.
		await new Promise(resolve => setTimeout(resolve, START_CHECK_MS));
		if (generation !== generationRef.current) return;
		if (isPlayingRef.current && music.playbackState !== window.MusicKit?.PlaybackStates?.playing) {
			setStatus(prev => (prev === 'ready' ? 'needs-start' : prev));
		}
	}, [music, isPlayingRef]);

	// Play whatever the server says is current, from the server's position.
	useEffect(() => {
		if (!canPlay) return undefined;
		const parsed = parseTrackKey(currentKey);
		if (!parsed || parsed.provider !== 'apple') {
			if (loadedEntryRef.current) {
				loadedEntryRef.current = null;
				readyEntryRef.current = null;
				try { music.stop(); } catch { /* nothing loaded */ }
			}
			return undefined;
		}
		if (loadedEntryRef.current === currentEntry) return undefined;
		// The developer token runs out soon: reload now, between two tracks,
		// rather than fail every load once it has.
		if (tokenExpiresAtRef.current && tokenExpiresAtRef.current - Date.now() < TOKEN_RENEW_BEFORE_MS) {
			window.location.reload();
			return undefined;
		}
		loadedEntryRef.current = currentEntry;
		readyEntryRef.current = null;
		durationSentForRef.current = null;
		errorSentForRef.current = null;
		const generation = generationRef.current;
		let cancelled = false;
		let finished = false;
		const stale = () => cancelled || generation !== generationRef.current;
		chainRef.current = chainRef.current.catch(() => {}).then(async () => {
			if (stale()) return;
			try {
				// Whatever played before must not go on under the new title, not
				// even when the new item cannot be loaded (13.11.2026).
				await Promise.resolve(music.stop()).catch(() => { /* nothing playing */ });
				if (stale()) return;
				const startTime = Math.max(0, Math.floor(progressRef.current || 0));
				await music.setQueue({ [parsed.kind]: parsed.id, startPlaying: false, startTime });
				if (stale()) return;
				if (!holdsCurrentItem()) throw Object.assign(new Error('MusicKit queued another item'), { errorCode: 'CONTENT_UNAVAILABLE' });
				readyEntryRef.current = currentEntry;
				finished = true;
				if (isPlayingRef.current) await play();
			} catch (err) {
				if (stale()) return;
				finished = true;
				if (isAutoplayRefusal(err)) {
					setStatus(prev => (prev === 'ready' ? 'needs-start' : prev));
					return;
				}
				try { music.stop(); } catch { /* nothing playing */ }
				// Tried again when the server plays this entry (again).
				loadedEntryRef.current = null;
				readyEntryRef.current = null;
				if (errorSentForRef.current === currentEntry) return;
				errorSentForRef.current = currentEntry;
				const code = errorCodeOf(err);
				setProblem({ code, message: describeMusicKitError(err) });
				sendRef.current({ type: 'PLAYBACK_ERROR', payload: { videoId: currentKey, errorCode: code, trackId: trackIdOf(currentEntry) } });
			}
		});
		return () => {
			cancelled = true;
			// A load cut short (React's second effect run in development, a
			// quick track change) has to be redone, not skipped as loaded.
			if (!finished && loadedEntryRef.current === currentEntry) loadedEntryRef.current = null;
		};
	}, [canPlay, currentKey, currentEntry, music, play, progressRef, isPlayingRef, sendRef, reloadTick, holdsCurrentItem]);

	// Follow the server's play/pause, for the item the server says is current.
	// Play for an entry that failed to load loads it again.
	useEffect(() => {
		if (!canPlay) return;
		if (readyEntryRef.current !== currentEntryRef.current) {
			if (isPlaying && currentEntryRef.current && loadedEntryRef.current !== currentEntryRef.current) {
				setReloadTick(tick => tick + 1);
			}
			return;
		}
		const playing = window.MusicKit?.PlaybackStates?.playing;
		if (isPlaying) {
			if (music.playbackState !== playing) play().catch(() => { /* reported by the error event */ });
		} else {
			try { music.pause(); } catch { /* nothing loaded */ }
		}
	}, [canPlay, isPlaying, music, play, currentEntryRef]);

	// Every few seconds: on the server's item, playing when the server plays,
	// and within a few seconds of the server's position.
	useEffect(() => {
		if (!canPlay) return undefined;
		const timer = setInterval(() => {
			const entry = currentEntryRef.current;
			if (!entry || readyEntryRef.current !== entry) return;
			const states = window.MusicKit?.PlaybackStates || {};
			const state = music.playbackState;
			if (music.nowPlayingItem && !holdsCurrentItem() && mismatchReloadedRef.current !== entry) {
				mismatchReloadedRef.current = entry;
				loadedEntryRef.current = null;
				readyEntryRef.current = null;
				try { music.stop(); } catch { /* nothing playing */ }
				setReloadTick(tick => tick + 1);
				return;
			}
			if (!isPlayingRef.current) return;
			// Where the server is now: its last report plus the time since.
			const elapsed = progressAtRef?.current ? (Date.now() - progressAtRef.current) / 1000 : 0;
			const expected = (progressRef.current || 0) + Math.max(0, elapsed);
			const duration = music.currentPlaybackDuration || 0;
			const nearEnd = duration && expected > duration - 2;
			if (state !== states.playing) {
				// Stopped under a playing room (a media key, headphones pulled,
				// the browser): start it again. Not near or past the end, where
				// MusicKit stops before the server moves on, and not while it loads.
				const settling = state === states.loading || state === states.waiting || state === states.seeking || state === states.stalled;
				const finishedItem = state === states.ended || state === states.completed;
				if (!nearEnd && !settling && !finishedItem && status === 'ready') {
					play().catch(() => { /* reported by the error event */ });
				}
				return;
			}
			if (nearEnd) return;
			if (Math.abs((music.currentPlaybackTime || 0) - expected) > MAX_DRIFT_S) {
				Promise.resolve(music.seekToTime(expected)).catch(() => { /* next check tries again */ });
			}
		}, DRIFT_CHECK_MS);
		return () => clearInterval(timer);
	}, [canPlay, music, status, play, progressRef, progressAtRef, isPlayingRef, currentEntryRef, holdsCurrentItem]);

	// Sign-in opens Apple's window. Its answer does not always reach this page
	// (Chrome, 13.11.2026), although MusicKit has stored the user token: then a
	// reload picks the sign-in up.
	const connect = useCallback(() => {
		if (!music) return;
		setProblem(null);
		setAwaitingSignIn(true);
		music.authorize().then(() => {
			if (music.isAuthorized && enabled) setStatus(prev => (prev === 'standby' ? prev : 'ready'));
		}).catch((err) => {
			setProblem({ code: errorCodeOf(err), message: describeMusicKitError(err) });
		});
	}, [music, enabled]);

	useEffect(() => {
		if (!awaitingSignIn || !music || !enabled) return undefined;
		const timer = setInterval(() => {
			if (music.isAuthorized) {
				setAwaitingSignIn(false);
				setStatus(prev => (prev === 'standby' ? prev : 'ready'));
				return;
			}
			if (hasStoredUserToken() && !reloadedForSignInRef.current) {
				reloadedForSignInRef.current = true;
				window.location.reload();
			}
		}, SIGN_IN_POLL_MS);
		return () => clearInterval(timer);
	}, [awaitingSignIn, music, enabled]);

	// The host's tap, when the browser refused to start playback on its own.
	const start = useCallback(() => {
		// play() puts the button back if this attempt does not start either.
		setStatus('ready');
		play().catch((err) => {
			setProblem({ code: errorCodeOf(err), message: describeMusicKitError(err) });
		});
	}, [play]);

	// "Play here" on a device on standby.
	const claim = useCallback(() => {
		sendRef.current({ type: 'APPLE_PLAYER_CLAIM' });
	}, [sendRef]);

	// The server paused the room over a problem on the host's side.
	const reportProblem = useCallback((code) => {
		if (code) setProblem({ code: String(code).slice(0, 60) });
	}, []);

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

	return { status, problem, connect, start, claim, reportProblem, seek, getDuration, setVolume };
}
