// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLatestRef } from './useLatestRef';
import { configureMusicKit, describeMusicKitError, fetchDeveloperToken, musicKitPlaysVideos } from '../utils/musicKit';
import { parseTrackKey } from '../utils/trackKeys';
import { roomPositionNow } from '../utils/roomPosition';

// The Apple Music player of an Apple room. MusicKit plays on one signed-in
// subscriber's device, so only the owner's browser plays; everyone else gets the
// playlist view. Like the YouTube player it follows the server: the server's
// current track, the server's play/pause, and the server advances the queue.
//
// The position is the other way round. Only this player knows where the music
// is: it tells the server (with APPLE_PLAYER_STATUS), and the room's clock
// goes by that. It jumps only when an owner moves the position by hand
// (SEEK_TO, counted in `seeks`). A server from before that count keeps its own
// clock, and this player is held to it as before (the drift check).
//
// One owner device plays the room at a time (`lease`, from the server): Apple
// streams one account on one device, and two players cut each other off.
// The others stand by and offer to take over. The player tells the server
// whether it can play (APPLE_PLAYER_STATUS); a room holds still while it
// cannot.
//
// The device's own controls (a phone's lock screen and Control Center, media
// keys, a headset) are the host's: they act on the room, see hostPlay.
//
// status: off | loading | signed-out | ready | needs-start | standby | error

const DRIFT_CHECK_MS = 5000;
const MAX_DRIFT_S = 3;
const SIGN_IN_POLL_MS = 2000;
const START_CHECK_MS = 3000;
// How long a start may go on loading before it counts as not started.
const START_PATIENCE_MS = 20000;
const STATUS_HEARTBEAT_MS = 10000;
// A playing player says where it is this often.
const POSITION_REPORT_MS = 5000;
// The last moments of an item are left alone: MusicKit ends an item that is
// sought to its end, and the room moves on from there anyway.
const END_GUARD_S = 1.5;
// A seek made on this device is under way in MusicKit for up to this long,
// and comes back from the room, counted, within the second span.
const OWN_SEEK_MS = 5000;
const OWN_ECHO_MS = 600;
// With a room that goes by this player's position there is nothing to
// correct. This far from the room twice in a row, the reports are not
// getting through, and the room's clock decides after all.
const FAR_OFF_S = 8;
const SONG_ASK_AGAIN_MS = 10000;
// The host's own controls (hostPlay): how often the room is asked again until
// it has followed, and for how long.
const ASK_AGAIN_MS = 3000;
const ASK_GIVE_UP_MS = 30000;
// A socket that just came back joins the room first; the server refuses a
// room message ahead of that.
const JOIN_FIRST_MS = 1500;
// The step of the system's skip buttons where it names none.
const SEEK_STEP_S = 15;
// A seek this soon after a track change was aimed at the previous track,
// whose bar was still showing. The server drops it as well.
const SEEK_AFTER_CHANGE_MS = 2000;
// MusicKit stops at the end of an item a moment before the server moves on.
// Finished further than this from the end, it is not waiting for the next
// track: it lost its place and the entry is loaded again.
const FINISHED_EARLY_S = MAX_DRIFT_S + 2;
const RELOAD_FINISHED_MS = 10000;
// A page whose developer token runs out within this reloads at the next track
// change; MusicKit takes its token once, at configure (24 h, renewed by the
// server below 12 h).
const TOKEN_RENEW_BEFORE_MS = 60 * 60 * 1000;

// On <html> while this device plays the room: "playing" when the room is meant
// to sound, "paused" when it is paused or has nothing to play. For the app
// wrappers, which read it in the main frame to know that a silent page is
// between two titles or paused, and not done. A frame cannot set it.
const PLAYER_MARK = 'data-apple-player';

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

// What MusicKit rejects authorize() with when the host closes Apple's sign-in
// window or declines there. No error: the connect button simply stays.
const SIGN_IN_CLOSED = new Set(['AUTHORIZATION_ERROR', 'ACCESS_DENIED']);

// "<queue entry id>|<track key>": what is loaded is tracked per entry, not per
// key, since the same song can come back as a new entry.
function entryOf(track) {
	return track ? `${track.id || ''}|${track.videoId || ''}` : null;
}

function trackIdOf(entry) {
	const id = entry ? entry.split('|')[0] : '';
	return id || undefined;
}

export function useAppleMusicHost({ enabled, currentTrack, isPlaying, progressRef, progressAtRef, sendMessage, lease, connected = true, seeks, waitingForHost = false }) {
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
	// The entry a song was asked for, in place of its music video (Android).
	const songAskedForRef = useRef(null);
	const storefrontSentRef = useRef(null);
	const reloadedForSignInRef = useRef(false);
	const tokenExpiresAtRef = useRef(0);
	// MusicKit calls run one after another: a cancelled load's setQueue must
	// not land after the next one's (14.11.2026).
	const chainRef = useRef(Promise.resolve());
	// Loads under way. MusicKit is "stopped" between taking an item and
	// starting it, which is not a player that lost its item (drift check).
	const loadingRef = useRef(0);
	// Bumped whenever this player may no longer play (switched off, standby,
	// signed out): async work started before checks it after every await.
	const generationRef = useRef(0);
	// What the host asked for on this device's own controls and the room has
	// not followed yet: 'play' | 'pause' (hostPlay). The ref is set with the
	// state: the checks below must see it before the next render.
	const askedRef = useRef(null);
	const [asked, setAskedState] = useState(null);
	const setAsked = useCallback((want) => {
		askedRef.current = want;
		setAskedState(want);
	}, []);
	// The length MusicKit gave for an entry: once the item has finished it no
	// longer says.
	const durationRef = useRef({ entry: null, seconds: 0 });
	const finishedReloadRef = useRef({ entry: null, at: 0 });
	const entrySinceRef = useRef(0);

	const currentKey = currentTrack?.videoId || null;
	const currentEntry = entryOf(currentTrack);
	const currentKeyRef = useLatestRef(currentKey);
	const currentEntryRef = useLatestRef(currentEntry);
	const isPlayingRef = useLatestRef(isPlaying);
	const sendRef = useLatestRef(sendMessage);
	const connectedRef = useLatestRef(connected);
	const roomDurationRef = useLatestRef(currentTrack?.duration || 0);
	useEffect(() => {
		entrySinceRef.current = Date.now();
	}, [currentEntry]);

	// The room's count of seeks made by hand: a number means the room's clock
	// goes by this player's reports. And how many of them this player has
	// followed; null while it holds no track at a settled position (loading,
	// just started), when it has no position to report.
	const seeksRef = useLatestRef(seeks);
	const followsPlayerRef = useLatestRef(typeof seeks === 'number');
	const followedSeeksRef = useRef(null);
	// The load that has yet to start playing: { entry, startTime, seeks }.
	const pendingStartRef = useRef(null);
	// Settles where a load started playing (set further down).
	const settleStartRef = useRef(() => {});
	// The last seek made on this device: the room echoes it back.
	const ownSeekRef = useRef({ target: 0, at: 0, done: null });
	const farOffRef = useRef(0);
	// Sends this player's state to the server now (set by the status effect).
	const reportRef = useRef(() => {});
	// Goes to the room's position after a seek (set further down).
	const followSeekRef = useRef(() => {});
	const runningRef = useLatestRef(!!isPlaying && !waitingForHost);
	// Where the room is now, by the server's clock.
	const roomPosition = useCallback(
		() => roomPositionNow(progressRef, progressAtRef, runningRef.current),
		[progressRef, progressAtRef, runningRef],
	);

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
		followedSeeksRef.current = null;
		pendingStartRef.current = null;
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
			if (entry && readyEntryRef.current === entry && duration > 0 && holdsCurrentItem()) {
				durationRef.current = { entry, seconds: duration };
			}
			if (entry && readyEntryRef.current === entry && durationSentForRef.current !== entry && duration > 0 && holdsCurrentItem()) {
				durationSentForRef.current = entry;
				sendRef.current({ type: 'UPDATE_DURATION', payload: { duration: Math.round(duration), trackId: trackIdOf(entry) } });
			}
			// The room learns at once where the music is: after a load, once
			// that is settled.
			const pending = pendingStartRef.current;
			if (pending && pending.entry === entry && readyEntryRef.current === entry) {
				pendingStartRef.current = null;
				settleStartRef.current(pending);
			} else {
				reportRef.current();
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
	//
	// A playing player also says where it is, and more often: the room's clock
	// goes by it (Room.followApplePosition). Only for the entry it holds, and
	// with the seeks it has followed: the server takes no position from before
	// a seek.
	useEffect(() => {
		if (!enabled) return undefined;
		let lastSent = 0;
		const report = () => {
			let state = 'blocked';
			if (lease === false) state = 'standby';
			else if (status === 'ready' && music) {
				state = music.playbackState === window.MusicKit?.PlaybackStates?.playing ? 'playing' : 'ready';
			}
			const payload = { state };
			const entry = currentEntryRef.current;
			const trackId = trackIdOf(entry);
			if (state === 'playing' && trackId && readyEntryRef.current === entry && followedSeeksRef.current !== null && holdsCurrentItem()) {
				payload.position = Math.max(0, music.currentPlaybackTime || 0);
				payload.trackId = trackId;
				payload.seeks = followedSeeksRef.current;
			}
			lastSent = Date.now();
			sendRef.current({ type: 'APPLE_PLAYER_STATUS', payload });
		};
		reportRef.current = report;
		report();
		const timer = setInterval(() => {
			const playing = !!music && music.playbackState === window.MusicKit?.PlaybackStates?.playing;
			if (playing || Date.now() - lastSent >= STATUS_HEARTBEAT_MS - 500) report();
		}, POSITION_REPORT_MS);
		return () => {
			clearInterval(timer);
			reportRef.current = () => {};
		};
	}, [enabled, lease, status, music, sendRef, currentEntryRef, holdsCurrentItem]);

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
		// Still loading is not refused: on a slow connection the start card
		// came up over a track that began a moment later, and with the phone
		// locked nobody was there to tap it (16.11.2026).
		const states = window.MusicKit?.PlaybackStates || {};
		for (let waited = START_CHECK_MS; ; waited += START_CHECK_MS) {
			await new Promise(resolve => setTimeout(resolve, START_CHECK_MS));
			if (generation !== generationRef.current) return;
			const state = music.playbackState;
			if (state === states.playing || !isPlayingRef.current || askedRef.current === 'pause') return;
			const loading = state === states.loading || state === states.waiting || state === states.seeking || state === states.stalled;
			if (!loading || waited >= START_PATIENCE_MS) break;
		}
		setStatus(prev => (prev === 'ready' ? 'needs-start' : prev));
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
		// MusicKit plays no music videos here (Android): the server makes the
		// entry its song (Room.playAppleVideoAsSong), which then loads like any
		// other. Meanwhile nothing of the previous track may go on.
		if (parsed.kind === 'musicVideo' && !musicKitPlaysVideos()) {
			if (loadedEntryRef.current) {
				loadedEntryRef.current = null;
				readyEntryRef.current = null;
				try { music.stop(); } catch { /* nothing playing */ }
			}
			if (songAskedForRef.current?.entry !== currentEntry) {
				songAskedForRef.current = { entry: currentEntry, at: Date.now() };
				sendRef.current({ type: 'APPLE_PLAY_AS_SONG', payload: { videoId: currentKey, trackId: trackIdOf(currentEntry) } });
			}
			return undefined;
		}
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
			loadingRef.current += 1;
			try {
				// Whatever played before must not go on under the new title, not
				// even when the new item cannot be loaded (13.11.2026).
				await Promise.resolve(music.stop()).catch(() => { /* nothing playing */ });
				if (stale()) return;
				// Where the room is now, not where it was at its last report: a
				// device that took over started up to five seconds back.
				const seeksAtLoad = seeksRef.current;
				const startTime = Math.max(0, Math.floor(roomPosition()));
				await music.setQueue({ [parsed.kind]: parsed.id, startPlaying: false, startTime });
				if (stale()) return;
				if (!holdsCurrentItem()) throw Object.assign(new Error('MusicKit queued another item'), { errorCode: 'CONTENT_UNAVAILABLE' });
				readyEntryRef.current = currentEntry;
				// No position is reported until it plays and that is settled.
				followedSeeksRef.current = null;
				pendingStartRef.current = { entry: currentEntry, startTime, seeks: seeksAtLoad };
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
			} finally {
				loadingRef.current -= 1;
			}
		});
		return () => {
			cancelled = true;
			// A load cut short (React's second effect run in development, a
			// quick track change) has to be redone, not skipped as loaded.
			if (!finished && loadedEntryRef.current === currentEntry) loadedEntryRef.current = null;
		};
	}, [canPlay, currentKey, currentEntry, music, play, roomPosition, seeksRef, isPlayingRef, sendRef, reloadTick, holdsCurrentItem]);

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
		// Not against what the host just asked for on this device: the room is
		// about to follow (hostPlay).
		if (isPlaying) {
			if (askedRef.current !== 'pause' && music.playbackState !== playing) play().catch(() => { /* reported by the error event */ });
		} else if (askedRef.current !== 'play') {
			try { music.pause(); } catch { /* nothing loaded */ }
		}
	}, [canPlay, isPlaying, music, play, currentEntryRef]);

	// Every few seconds: on the server's item, playing when the server plays,
	// and within a few seconds of the server's position.
	useEffect(() => {
		if (!canPlay) return undefined;
		const timer = setInterval(() => {
			const entry = currentEntryRef.current;
			if (!entry || readyEntryRef.current !== entry) {
				// Still waiting for the song of a music video (Android): a message
				// lost to a reconnect would leave the room on an item this device
				// cannot play, so ask again now and then.
				const asked = songAskedForRef.current;
				if (entry && asked?.entry === entry && Date.now() - asked.at > SONG_ASK_AGAIN_MS) {
					asked.at = Date.now();
					sendRef.current({ type: 'APPLE_PLAY_AS_SONG', payload: { videoId: currentKeyRef.current, trackId: trackIdOf(entry) } });
				}
				return;
			}
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
			const expected = roomPosition();
			const known = durationRef.current.entry === entry ? durationRef.current.seconds : 0;
			const duration = music.currentPlaybackDuration || known || roomDurationRef.current || 0;
			const nearEnd = duration && expected > duration - 2;
			if (state !== states.playing) {
				// Paused on this device's own controls: the room is being told.
				if (askedRef.current === 'pause') return;
				const settling = state === states.loading || state === states.waiting || state === states.seeking || state === states.stalled;
				if (settling || loadingRef.current > 0) return;
				const finishedItem = state === states.ended || state === states.completed;
				if (finishedItem || state === states.stopped || state === states.none) {
					// MusicKit has let go of the item. At the end of a track that is
					// in order: it stops a moment before the server moves on. Well
					// before the end (a seek or a skip past it that the room did not
					// take, an item that broke off) it stayed silent for the rest of
					// the track: load the entry again at the server's position.
					const early = duration ? expected < duration - FINISHED_EARLY_S : !finishedItem;
					const last = finishedReloadRef.current;
					if (early && status === 'ready' && (last.entry !== entry || Date.now() - last.at > RELOAD_FINISHED_MS)) {
						finishedReloadRef.current = { entry, at: Date.now() };
						loadedEntryRef.current = null;
						readyEntryRef.current = null;
						setReloadTick(tick => tick + 1);
					}
					return;
				}
				// Paused under a playing room (headphones pulled, the browser):
				// start it again, but not near the end.
				if (!nearEnd && status === 'ready') {
					play().catch(() => { /* reported by the error event */ });
				}
				return;
			}
			if (nearEnd) return;
			const off = Math.abs((music.currentPlaybackTime || 0) - expected);
			if (followsPlayerRef.current) {
				// The room's clock goes by this player: nothing to correct, and a
				// seek back to the clock was heard every time (18.11.2026).
				farOffRef.current = off > FAR_OFF_S ? farOffRef.current + 1 : 0;
				if (farOffRef.current < 2) return;
				farOffRef.current = 0;
			}
			// Only within an item MusicKit has loaded: a seek while it had no
			// length yet ended the item (16.11.2026).
			const loaded = music.currentPlaybackDuration || 0;
			if (loaded > 0 && expected < loaded - 1 && off > MAX_DRIFT_S) {
				const count = seeksRef.current;
				Promise.resolve(music.seekToTime(expected)).then(() => {
					if (typeof count === 'number' && seeksRef.current === count) followedSeeksRef.current = count;
				}).catch(() => { /* next check tries again */ });
			}
		}, DRIFT_CHECK_MS);
		return () => clearInterval(timer);
	}, [canPlay, music, status, play, roomPosition, isPlayingRef, currentEntryRef, currentKeyRef, sendRef, roomDurationRef, holdsCurrentItem, seeksRef, followsPlayerRef]);

	// Moves this device's player. The last moments of an item are left alone
	// (END_GUARD_S): the room, which the caller tells, moves on from there.
	const seekHere = useCallback((seconds) => {
		if (!music) return;
		const duration = music.currentPlaybackDuration || 0;
		if (duration && seconds > duration - END_GUARD_S) {
			ownSeekRef.current = { target: seconds, at: Date.now(), done: null };
			return;
		}
		const done = Promise.resolve(music.seekToTime(Math.max(0, seconds))).catch(() => { /* followSeek puts it right */ });
		ownSeekRef.current = { target: seconds, at: Date.now(), done };
	}, [music]);

	// An owner moved the room's position by hand, on this device or on another
	// (`seeks` went up): be there at once. Before the room counted its seeks,
	// the player noticed up to five seconds later, and only a difference of
	// more than three seconds; from the owner's other device a seek seemed to
	// do nothing (18.11.2026).
	const followSeek = useCallback(async () => {
		if (!music || typeof seeksRef.current !== 'number') return;
		const generation = generationRef.current;
		// A seek made here: MusicKit is still at it, and the room's answer to
		// it may not be the last one on its way.
		const own = ownSeekRef.current;
		const sinceOwn = Date.now() - own.at;
		if (sinceOwn < OWN_SEEK_MS) {
			await Promise.resolve(own.done);
			if (sinceOwn < OWN_ECHO_MS) await new Promise(resolve => setTimeout(resolve, OWN_ECHO_MS - sinceOwn));
			if (generation !== generationRef.current) return;
		}
		const count = seeksRef.current;
		if (followedSeeksRef.current === count) return;
		const entry = currentEntryRef.current;
		// Not loaded yet: the load ends with this check.
		if (!entry || readyEntryRef.current !== entry || !holdsCurrentItem()) return;
		const target = roomPosition();
		const duration = music.currentPlaybackDuration || roomDurationRef.current || 0;
		// The end of the item: the room moves on. Until then nothing is reported
		// from the old position, which would take the seek back.
		if (duration && target > duration - END_GUARD_S) return;
		if (Math.abs((music.currentPlaybackTime || 0) - target) >= END_GUARD_S) {
			await Promise.resolve(music.seekToTime(target)).catch(() => { /* the far-off check puts it right */ });
			if (generation !== generationRef.current) return;
		}
		// Another seek meanwhile runs this again.
		if (seeksRef.current !== count || currentEntryRef.current !== entry) return;
		followedSeeksRef.current = count;
		reportRef.current();
	}, [music, seeksRef, currentEntryRef, holdsCurrentItem, roomPosition, roomDurationRef]);
	useEffect(() => {
		followSeekRef.current = followSeek;
	}, [followSeek]);

	useEffect(() => {
		if (!canPlay || typeof seeks !== 'number') return;
		const followed = followedSeeksRef.current;
		// Loading or just started: the start settles on the room's position.
		if (followed === null) return;
		// A server that counts anew: nothing was moved by hand.
		if (seeks < followed) {
			followedSeeksRef.current = seeks;
			return;
		}
		if (seeks > followed) followSeek();
	}, [canPlay, seeks, followSeek]);

	// A load has started to play. A new track starts at its beginning, a
	// moment after the room said so, and the room's clock is set by it. A
	// track taken over in the middle (another device played it, a reload, a
	// seek while it loaded) has to be where the room is: MusicKit is told the
	// position with the load and does not always start there (never with
	// previews). Only then does this player report its position.
	const settleStart = useCallback(async (pending) => {
		if (!music) return;
		const generation = generationRef.current;
		const states = window.MusicKit?.PlaybackStates || {};
		const gone = () => generation !== generationRef.current || currentEntryRef.current !== pending.entry || readyEntryRef.current !== pending.entry;
		// MusicKit says "playing" a moment before it is.
		for (let waited = 0; waited < 5000; waited += 250) {
			await new Promise(resolve => setTimeout(resolve, 250));
			if (gone()) return;
			if (music.playbackState === states.playing) break;
		}
		// A server that keeps its own clock: the drift check holds this player to it.
		const count = seeksRef.current;
		if (typeof count !== 'number') return;
		const target = roomPosition();
		const duration = music.currentPlaybackDuration || roomDurationRef.current || 0;
		const midTrack = pending.startTime > 2 || (typeof pending.seeks === 'number' && count > pending.seeks);
		if (midTrack && Math.abs((music.currentPlaybackTime || 0) - target) > 2) {
			// The end of the item: the room moves on.
			if (duration && target > duration - END_GUARD_S) return;
			await Promise.resolve(music.seekToTime(target)).catch(() => { /* the far-off check puts it right */ });
			if (gone()) return;
		}
		followedSeeksRef.current = count;
		// A seek while this settled.
		if (seeksRef.current > count) followSeekRef.current();
		else reportRef.current();
	}, [music, seeksRef, currentEntryRef, roomPosition, roomDurationRef]);
	useEffect(() => {
		settleStartRef.current = settleStart;
	}, [settleStart]);

	// Play, pause and seek on this device's own controls: the lock screen and
	// Control Center of a phone, a keyboard's media keys, a headset. MusicKit
	// wires them to its local player, and the room, which plays by the server's
	// say, took none of it: a pause came back on within seconds, a seek jumped
	// back, a seek to the end left the player silent on a finished item (iPhone
	// app, 15.11.2026). They are the host's controls, so they act on the room
	// like the buttons on the page.
	const tellRoom = useCallback((want) => {
		if (!connectedRef.current) return; // sent once the socket is back, see below
		if (want === 'play') {
			// Play pressed here means play here, also when another owner device
			// took the room over while this one slept.
			sendRef.current({ type: 'APPLE_PLAYER_CLAIM' });
			sendRef.current({ type: 'PLAY_PAUSE', payload: true });
		} else {
			sendRef.current({ type: 'PLAY_PAUSE', payload: false });
		}
	}, [connectedRef, sendRef]);

	const hostPause = useCallback(() => {
		if (!music) return;
		setAsked('pause');
		try { music.pause(); } catch { /* nothing loaded */ }
		tellRoom('pause');
	}, [music, setAsked, tellRoom]);

	const hostPlay = useCallback(() => {
		if (!music) return;
		setAsked('play');
		// Only what the room is on: after a long sleep MusicKit may hold an
		// item that is over, and the room's track loads once the socket is back.
		const states = window.MusicKit?.PlaybackStates || {};
		const finishedItem = music.playbackState === states.ended || music.playbackState === states.completed;
		if (readyEntryRef.current && readyEntryRef.current === currentEntryRef.current && !finishedItem && holdsCurrentItem()) {
			play().catch(() => { /* reported by the error event */ });
		}
		tellRoom('play');
	}, [music, setAsked, tellRoom, play, currentEntryRef, holdsCurrentItem]);

	const hostSeek = useCallback((seconds) => {
		if (!music || !Number.isFinite(seconds)) return;
		if (readyEntryRef.current !== currentEntryRef.current) return;
		if (Date.now() - entrySinceRef.current < SEEK_AFTER_CHANGE_MS) return;
		const duration = music.currentPlaybackDuration || 0;
		const target = Math.max(0, duration ? Math.min(seconds, duration) : seconds);
		// The end of the bar moves the room on to the next track, as on the page.
		sendRef.current({ type: 'SEEK_TO', payload: target });
		seekHere(target);
	}, [music, sendRef, currentEntryRef, seekHere]);

	// An ask stands until the room has followed. tellRoom sends it at once
	// over an open socket; this sends it again: after a reconnect (the phone
	// slept through its pause) or when a message got lost.
	useEffect(() => {
		if (!asked) return undefined;
		if (!enabled || (asked === 'play') === !!isPlaying) {
			setAsked(null);
			return undefined;
		}
		if (!connected) return undefined;
		const since = Date.now();
		let timer = setTimeout(function again() {
			if (Date.now() - since > ASK_GIVE_UP_MS) {
				setAsked(null);
				return;
			}
			tellRoom(asked);
			timer = setTimeout(again, ASK_AGAIN_MS);
		}, JOIN_FIRST_MS);
		return () => clearTimeout(timer);
	}, [asked, enabled, isPlaying, connected, setAsked, tellRoom]);

	// Tell the app wrappers that this device plays the room (PLAYER_MARK).
	useEffect(() => {
		if (!canPlay) return undefined;
		const sounding = asked ? asked === 'play' : !!isPlaying && !!currentKey;
		document.documentElement.setAttribute(PLAYER_MARK, sounding ? 'playing' : 'paused');
		return () => document.documentElement.removeAttribute(PLAYER_MARK);
	}, [canPlay, asked, isPlaying, currentKey]);

	// The system's media controls, while this device plays the room.
	useEffect(() => {
		const session = typeof navigator !== 'undefined' ? navigator.mediaSession : null;
		if (!canPlay || !session) return undefined;
		const set = (action, handler) => {
			try { session.setActionHandler(action, handler); } catch { /* an action this browser does not know */ }
		};
		const seekBy = (step) => hostSeek((music.currentPlaybackTime || 0) + step);
		const apply = () => {
			set('play', hostPlay);
			set('pause', hostPause);
			set('stop', hostPause);
			set('seekto', (details) => hostSeek(details?.seekTime));
			set('seekforward', (details) => seekBy(details?.seekOffset || SEEK_STEP_S));
			set('seekbackward', (details) => seekBy(-(details?.seekOffset || SEEK_STEP_S)));
			// MusicKit's own would skip within its one-item queue: the end of it.
			set('nexttrack', null);
			set('previoustrack', null);
		};
		apply();
		// MusicKit puts its handlers back whenever what it can do changes.
		music.addEventListener('capabilitiesChanged', apply);
		return () => {
			music.removeEventListener('capabilitiesChanged', apply);
			['play', 'pause', 'stop', 'seekto', 'seekforward', 'seekbackward'].forEach(action => set(action, null));
		};
	}, [canPlay, music, hostPlay, hostPause, hostSeek]);

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
			const code = errorCodeOf(err);
			if (SIGN_IN_CLOSED.has(code)) return;
			setProblem({ code, message: describeMusicKitError(err), signIn: true });
		});
	}, [music, enabled]);

	// Signs the Apple account out, for a host who connected one without a
	// subscription. The authorization event above brings the connect button back.
	const disconnect = useCallback(() => {
		if (!music) return;
		setProblem(null);
		Promise.resolve(music.unauthorize()).catch(() => { /* still signed in: the problem comes back with the next play */ });
	}, [music]);

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
		// MusicKit has let go of the item meanwhile: load it again.
		if (readyEntryRef.current && !holdsCurrentItem()) {
			loadedEntryRef.current = null;
			readyEntryRef.current = null;
			setReloadTick(tick => tick + 1);
			return;
		}
		play().catch((err) => {
			setProblem({ code: errorCodeOf(err), message: describeMusicKitError(err) });
		});
	}, [play, holdsCurrentItem]);

	// "Play here" on a device on standby.
	const claim = useCallback(() => {
		sendRef.current({ type: 'APPLE_PLAYER_CLAIM' });
	}, [sendRef]);

	// The server paused the room over a problem on the host's side.
	const reportProblem = useCallback((code) => {
		if (code) setProblem({ code: String(code).slice(0, 60) });
	}, []);

	// The owner's seek on the page, for this device's player. The page tells
	// the room.
	const seek = useCallback((seconds) => {
		if (!canPlay) return;
		seekHere(seconds);
	}, [canPlay, seekHere]);

	const getDuration = useCallback(() => (music?.currentPlaybackDuration || 0), [music]);

	// Where the music is on this device, in seconds; null while this device
	// does not hold the room's track at a settled position (standby, loading,
	// just started). The room's clock says it then.
	const getPosition = useCallback(() => {
		if (!canPlayRef.current || !music || followedSeeksRef.current === null) return null;
		const entry = currentEntryRef.current;
		if (!entry || readyEntryRef.current !== entry || !holdsCurrentItem()) return null;
		const states = window.MusicKit?.PlaybackStates || {};
		const state = music.playbackState;
		if (state !== states.playing && state !== states.paused && state !== states.seeking) return null;
		return music.currentPlaybackTime || 0;
	}, [music, canPlayRef, currentEntryRef, holdsCurrentItem]);

	// 0..1. A new identity once MusicKit is loaded, so callers apply it again.
	const setVolume = useCallback((level) => {
		if (!music) return;
		try {
			music.volume = Math.min(1, Math.max(0, Number(level) || 0));
		} catch { /* not ready yet */ }
	}, [music]);

	return { status, problem, connect, disconnect, start, claim, reportProblem, seek, getDuration, getPosition, setVolume };
}
