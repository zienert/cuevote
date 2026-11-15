// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// DEV-ONLY preview (route /__room-preview, gated by import.meta.env.DEV in
// main.jsx, not bundled in production). Renders the real RoomBody without a
// backend: a mock socket holds the room and answers votes, suggestions and the
// host's controls locally. Nothing is loaded from YouTube or Apple: cover art
// is generated SVG, and stand-ins take the place of the YouTube player and of
// MusicKit.
//
// Query parameters:
//   ?provider=apple   an Apple Music channel (default: a YouTube channel)
//   ?role=owner       the host (default: a guest)
//   ?device=phone|android|app|desktop
//                     what the device detection answers: a phone browser, an
//                     Android browser, the phone app, a computer (default: the
//                     real device)
//   ?apple=...        what Apple Music does for the host of an Apple channel:
//                     signed-out (default), cancel (the sign-in window is
//                     closed), signin-failed, ready, needs-start, problem,
//                     subscription, other-device, standby, loading, error
//   ?code=...         the error code of ?apple=problem (default MEDIA_PLAYBACK)
//                     and of ?apple=signin-failed (default NETWORK_ERROR)
//   ?stuck            the problem comes back on every retry
//   ?auto=connect     press "Connect Apple Music" right away
//   ?suggest          open the suggest field
//   ?waiting          an Apple channel paused until the host plays again
//   ?appleConsent=0   a guest who has not turned Apple content on
//   ?empty            nothing queued
//   ?lang=de          the language
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import RoomBody from '../RoomBody';
import { WebSocketContext } from '../contexts/WebSocketContext';
import { ConsentContext } from '../contexts/ConsentContextValue';
import { Consent } from '../contexts/ConsentContext';
import { Language } from '../contexts/LanguageContext';
import { DEVELOPER_TOKEN_URL } from '../utils/musicKit';
import { deviceDetection } from '../utils/deviceDetection';

const PARAMS = new URLSearchParams(window.location.search);

// What the device detection answers, per ?device. Set before the room renders:
// RoomBody and Header ask while rendering.
const DEVICES = {
	phone: { isIOS: true, isMobile: true, isMobileWebBrowser: true },
	android: { isAndroid: true, isMobile: true, isMobileWebBrowser: true },
	app: { isIOS: true, isMobile: true, isNativeApp: true },
	desktop: {},
};
const DEVICE = DEVICES[PARAMS.get('device')];
if (DEVICE) {
	for (const name of Object.keys(deviceDetection)) {
		const answer = DEVICE[name] === true;
		deviceDetection[name] = () => answer;
	}
}

// RoomBody falls back to this id without a :roomId in the path.
const ROOM_ID = 'synthwave';
const OWNER = { id: 'preview-owner', name: 'Alex', email: 'alex@example.com', picture: null };
const GUEST = { id: 'preview-guest', name: 'Guest K7QF', isGuest: true, guestTag: 'K7QF' };

// Stand-ins for cover art and video thumbnails.
const PALETTES = [
	['#1a0b2e', '#ff6a3d', '#6b2bd9'], ['#0b1d2e', '#2dd4bf', '#1e3a8a'], ['#120d0a', '#ef4444', '#f97316'],
	['#10151f', '#f59e0b', '#be185d'], ['#0a1410', '#22c55e', '#0ea5e9'], ['#1f1021', '#ec4899', '#8b5cf6'],
	['#0f172a', '#38bdf8', '#f472b6'], ['#1c1917', '#facc15', '#ea580c'], ['#111827', '#a78bfa', '#34d399'],
];
function cover(index) {
	const [base, glowA, glowB] = PALETTES[index % PALETTES.length];
	const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">'
		+ `<defs><radialGradient id="a" cx="20%" cy="15%" r="80%"><stop offset="0" stop-color="${glowA}"/><stop offset="1" stop-color="${glowA}" stop-opacity="0"/></radialGradient>`
		+ `<radialGradient id="b" cx="85%" cy="85%" r="75%"><stop offset="0" stop-color="${glowB}"/><stop offset="1" stop-color="${glowB}" stop-opacity="0"/></radialGradient></defs>`
		+ `<rect width="300" height="300" fill="${base}"/><rect width="300" height="300" fill="url(#a)"/><rect width="300" height="300" fill="url(#b)"/>`
		+ '<circle cx="150" cy="150" r="58" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="2"/><circle cx="150" cy="150" r="9" fill="#fff" fill-opacity=".3"/></svg>';
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const SONGS = [
	['Blinding Lights', 'The Weeknd'], ['Levitating', 'Dua Lipa'], ['Major Tom', 'Peter Schilling'],
	['As It Was', 'Harry Styles'], ['Flowers', 'Miley Cyrus'], ['Mr. Brightside', 'The Killers'],
	['Bad Guy', 'Billie Eilish'], ['99 Luftballons', 'Nena'], ['Uptown Funk', 'Mark Ronson ft. Bruno Mars'],
	['Dance Monkey', 'Tones and I'], ['Shape of You', 'Ed Sheeran'], ['Wonderwall', 'Oasis'],
	['Believer', 'Imagine Dragons'], ['Sunflower', 'Post Malone & Swae Lee'], ['Atemlos durch die Nacht', 'Helene Fischer'],
];
const SUGGESTERS = [
	{ suggestedByUsername: 'Mia' }, { suggestedByIsGuest: true, suggestedByGuestTag: 'K7QF' }, { suggestedByUsername: 'Lukas' },
	{ suggestedByIsGuest: true, suggestedByGuestTag: 'P2MX' }, { suggestedByUsername: 'Alex' },
];

// Track keys as the server writes them: an 11-character YouTube id, or
// am:song:<id> in an Apple Music channel.
function trackKey(provider, index) {
	return provider === 'apple' ? `am:song:${1000000000 + index}` : `preview${String(index).padStart(4, '0')}`;
}

function track(provider, index, extra = {}) {
	const [title, artist] = SONGS[index % SONGS.length];
	return {
		id: `entry-${index}`,
		videoId: trackKey(provider, index),
		title,
		artist,
		thumbnail: cover(index),
		duration: 200,
		score: 0,
		...SUGGESTERS[index % SUGGESTERS.length],
		...extra,
	};
}

// queue[0] mirrors currentTrack, as in a live room.
function initialRoom(provider, { empty, waiting }) {
	const now = Date.now();
	const history = empty ? [] : [0, 1, 2].map(i => track(provider, i, { id: `played-${i}`, playedAt: now - (30 - i * 8) * 60000 }));
	const scores = [6, 4, 3, 2, 1, 0, 0];
	const queue = empty ? [] : [
		track(provider, 3),
		...scores.map((score, i) => track(provider, 4 + i, { score, myVote: i === 1 ? 'up' : undefined })),
	];
	return {
		roomId: ROOM_ID,
		activeChannel: 'WG-Party Küche',
		ownerId: OWNER.id,
		provider,
		queue,
		currentTrack: queue[0] || null,
		isPlaying: queue.length > 0,
		progress: 47,
		history,
		suggestionsEnabled: true,
		votesEnabled: true,
		allowPrelisten: true,
		playlistViewMode: false,
		suggestionMode: 'auto',
		pendingSuggestions: [],
		ownerPopups: true,
		bannedVideos: [],
		appleStorefront: provider === 'apple' ? 'de' : null,
		waitingForHost: !!waiting,
	};
}

// Upcoming tracks by score; the current one stays first.
function sortUpcoming(queue) {
	const [current, ...upcoming] = queue;
	if (!current) return queue;
	return [current, ...upcoming.sort((a, b) => (b.score || 0) - (a.score || 0))];
}

// Codes the server pauses the room for (the host's side), as opposed to an
// item it skips.
const APPLE_ITEM_ERRORS = new Set(['CONTENT_UNAVAILABLE', 'CONTENT_RESTRICTED', 'CONTENT_UNSUPPORTED', 'MEDIA_KEY', 'NOT_FOUND']);

const PROBLEM_CODES = { subscription: 'SUBSCRIPTION_ERROR', 'other-device': 'DEVICE_LIMIT' };

// A stand-in for MusicKit JS, enough for useAppleMusicHost: sign-in, one
// queued item, play and pause, and the failures a scenario asks for.
function fakeMusicKit(scenario, { code, stuck }) {
	const PlaybackStates = { none: 0, loading: 1, playing: 2, paused: 3, stopped: 4, ended: 5, seeking: 6, waiting: 8, stalled: 9, completed: 10 };
	const listeners = new Map();
	const emit = (name) => [...(listeners.get(name) || [])].forEach(listener => listener({}));
	const problemCode = scenario === 'problem' ? code : PROBLEM_CODES[scenario];
	let failures = problemCode ? (stuck ? Infinity : 1) : 0;
	let refusals = scenario === 'needs-start' ? 1 : 0;
	const setState = (state) => {
		instance.playbackState = state;
		emit('playbackStateDidChange');
	};
	const instance = {
		isAuthorized: !['signed-out', 'cancel', 'signin-failed'].includes(scenario),
		autoplayEnabled: false,
		previewOnly: false,
		playbackState: PlaybackStates.none,
		nowPlayingItem: null,
		queue: { items: [] },
		currentPlaybackDuration: 0,
		currentPlaybackTime: 0,
		volume: 1,
		addEventListener(name, listener) {
			if (!listeners.has(name)) listeners.set(name, new Set());
			listeners.get(name).add(listener);
		},
		removeEventListener(name, listener) {
			listeners.get(name)?.delete(listener);
		},
		// Apple's sign-in window: closed without signing in, or signed in.
		authorize: () => new Promise((resolve, reject) => {
			setTimeout(() => {
				if (scenario === 'cancel') {
					reject(Object.assign(new Error('The sign-in window was closed'), { errorCode: 'AUTHORIZATION_ERROR' }));
					return;
				}
				if (scenario === 'signin-failed') {
					reject(Object.assign(new Error('The sign-in failed'), { errorCode: code }));
					return;
				}
				instance.isAuthorized = true;
				emit('authorizationStatusDidChange');
				resolve('preview-user-token');
			}, 600);
		}),
		unauthorize: async () => {
			instance.isAuthorized = false;
			emit('authorizationStatusDidChange');
		},
		stop: async () => {
			instance.nowPlayingItem = null;
			if (instance.playbackState !== PlaybackStates.none) setState(PlaybackStates.stopped);
		},
		setQueue: async (options) => {
			const id = options.song || options.musicVideo || options.items?.[0]?.id;
			instance.queue = { items: [{ id }] };
			instance.nowPlayingItem = null;
			instance.currentPlaybackDuration = 200;
			instance.currentPlaybackTime = options.startTime || 0;
			return instance.queue;
		},
		play: async () => {
			if (refusals > 0) {
				refusals -= 1;
				throw new DOMException('Playback needs a click', 'NotAllowedError');
			}
			if (failures > 0) {
				failures -= 1;
				throw Object.assign(new Error(problemCode), { errorCode: problemCode });
			}
			instance.nowPlayingItem = instance.queue.items[0] || null;
			setState(PlaybackStates.playing);
		},
		pause: () => setState(PlaybackStates.paused),
		seekToTime: async (seconds) => {
			instance.currentPlaybackTime = seconds;
		},
		api: { music: async () => ({ data: { data: [{ id: 'de' }] } }) },
	};
	return { PlaybackStates, configure: async () => instance, getInstance: () => instance };
}

// A stand-in for the YouTube IFrame API: a player that "plays" a still frame.
function fakeYouTube(progressRef) {
	class Player {
		constructor(container, options) {
			this.events = options?.events || {};
			this.videoId = null;
			this.state = -1;
			if (container?.style) {
				container.style.background = 'radial-gradient(120% 90% at 20% 15%, #3b1d5e 0%, transparent 60%), radial-gradient(110% 90% at 85% 90%, #7c2d12 0%, transparent 55%), #0b0b10';
			}
			setTimeout(() => this.events.onReady?.({ target: this }), 30);
		}
		setState(state) {
			this.state = state;
			setTimeout(() => this.events.onStateChange?.({ data: state, target: this }), 0);
		}
		getVideoData() { return { video_id: this.videoId }; }
		loadVideoById(videoId) { this.videoId = videoId; this.setState(1); }
		playVideo() { if (this.videoId && this.state !== 1) this.setState(1); }
		pauseVideo() { if (this.videoId && this.state !== 2) this.setState(2); }
		stopVideo() { this.videoId = null; this.state = 5; }
		seekTo() {}
		getDuration() { return 200; }
		getCurrentTime() { return progressRef.current; }
		getPlayerState() { return this.state; }
		setVolume() {}
		mute() {}
		unMute() {}
		setOption() {}
		destroy() {}
	}
	return { Player };
}

export default function RoomPreview() {
	const provider = PARAMS.get('provider') === 'apple' ? 'apple' : 'youtube';
	const isOwner = PARAMS.get('role') === 'owner';
	const scenario = PARAMS.get('apple') || 'signed-out';
	const problemCode = PARAMS.get('code') || (scenario === 'signin-failed' ? 'NETWORK_ERROR' : 'MEDIA_PLAYBACK');
	const stuck = PARAMS.has('stuck');
	const lang = PARAMS.get('lang');

	const [room, setRoom] = useState(() => initialRoom(provider, { empty: PARAMS.has('empty'), waiting: PARAMS.has('waiting') }));
	const [lastMessage, setLastMessage] = useState(null);
	const [lease, setLease] = useState(scenario === 'standby' ? false : true);
	const progressRef = useRef(47);
	const progressAtRef = useRef(Date.now());
	const added = useRef(0);

	const sendMessage = useCallback((message) => {
		const payload = message.payload;
		switch (message.type) {
			case 'VOTE':
				setRoom(current => ({
					...current,
					queue: sortUpcoming(current.queue.map((entry) => {
						if (entry.id !== payload.trackId) return entry;
						const previous = entry.myVote === 'up' ? 1 : entry.myVote === 'down' ? -1 : 0;
						const myVote = entry.myVote === payload.voteType ? undefined : payload.voteType;
						const next = myVote === 'up' ? 1 : myVote === 'down' ? -1 : 0;
						return { ...entry, myVote, score: (entry.score || 0) - previous + next };
					})),
				}));
				break;
			case 'SUGGEST_SONG': {
				added.current += 1;
				const index = 11 + added.current;
				const isLink = /^https?:/.test(payload.query);
				const entry = track(provider, index, {
					id: `added-${added.current}`,
					...(isLink ? {} : { title: payload.query, artist: 'CueVote Preview' }),
					suggestedByUsername: isOwner ? OWNER.name : undefined,
					suggestedByIsGuest: !isOwner,
					suggestedByGuestTag: isOwner ? undefined : GUEST.guestTag,
				});
				setRoom(current => {
					const queue = [...current.queue, entry];
					return { ...current, queue, currentTrack: queue[0], isPlaying: true };
				});
				setLastMessage({ type: 'success', message: 'Added' });
				break;
			}
			case 'DELETE_SONG':
				setRoom(current => {
					const queue = current.queue.filter(entry => entry.id !== payload.trackId);
					return { ...current, queue, currentTrack: queue[0] || null };
				});
				break;
			case 'PLAY_PAUSE':
				setRoom(current => ({ ...current, isPlaying: !!payload }));
				break;
			case 'SEEK_TO':
				progressRef.current = Number(payload) || 0;
				progressAtRef.current = Date.now();
				break;
			case 'UPDATE_SETTINGS':
				setRoom(current => ({ ...current, ...payload }));
				break;
			case 'PLAYBACK_ERROR':
				// The server's answer in an Apple channel: a problem on the host's
				// side pauses the room and is reported back to the host.
				if (provider === 'apple' && !APPLE_ITEM_ERRORS.has(payload.errorCode)) {
					setRoom(current => ({ ...current, isPlaying: false }));
					setLastMessage({ type: 'APPLE_PLAYBACK_PROBLEM', payload: { code: payload.errorCode } });
				}
				break;
			case 'APPLE_PLAYER_CLAIM':
				setLease(true);
				break;
			case 'FETCH_SUGGESTIONS':
				setLastMessage({
					type: 'SUGGESTION_RESULT',
					payload: { suggestions: [12, 13, 14].map(i => track(provider, i, { id: `similar-${i}` })) },
				});
				break;
			case 'REMOVE_FROM_LIBRARY':
				setRoom(current => ({ ...current, history: current.history.filter(entry => entry.videoId !== payload.videoId) }));
				break;
			default:
				// JOIN_ROOM, UPDATE_DURATION, APPLE_PLAYER_STATUS, APPLE_STOREFRONT, ...
				break;
		}
	}, [provider, isOwner]);

	const socket = useMemo(() => ({
		state: room,
		isConnected: true,
		sendMessage,
		lastError: null,
		lastErrorCode: null,
		lastErrorTimestamp: 0,
		lastMessage,
		clientId: 'preview',
		user: isOwner ? OWNER : GUEST,
		handleLoginSuccess: () => {},
		handleLogout: () => {},
		clearMessage: () => setLastMessage(null),
		reconnectAttempt: 0,
		forceReconnect: () => {},
		connectionQuality: 'good',
		progressRef,
		progressAtRef,
		applePlayerLease: provider === 'apple' && isOwner ? lease : null,
	}), [room, sendMessage, lastMessage, isOwner, provider, lease]);

	// The cookie banner belongs to the real page around this one: keep it
	// closed. The room below gets its own consent value.
	const outerConsent = Consent.useConsent();
	useEffect(() => {
		if (outerConsent.showBanner) outerConsent.setShowBanner(false);
	}, [outerConsent]);
	const [appleConsent, setAppleConsent] = useState(PARAMS.get('appleConsent') !== '0');
	const consent = useMemo(() => ({
		...outerConsent,
		hasConsent: true,
		showBanner: false,
		askForConsent: () => {},
		hasAppleConsent: appleConsent,
		giveAppleConsent: () => setAppleConsent(true),
	}), [outerConsent, appleConsent]);

	// Stand-ins for everything the room would load from YouTube and Apple. In
	// place before the room's own effects ask for them.
	useLayoutEffect(() => {
		const realFetch = window.fetch;
		window.fetch = (input, init) => {
			const url = typeof input === 'string' ? input : input?.url || '';
			if (!url.endsWith(DEVELOPER_TOKEN_URL)) return realFetch.call(window, input, init);
			if (scenario === 'loading') return new Promise(() => {});
			if (scenario === 'error') return Promise.resolve(new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } }));
			const body = JSON.stringify({ token: 'preview', expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
			return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }));
		};
		window.MusicKit = fakeMusicKit(scenario, { code: problemCode, stuck });
		window.YT = fakeYouTube(progressRef);
		return () => { window.fetch = realFetch; };
	}, [scenario, problemCode, stuck]);

	const { setLanguage } = Language.useLanguage();
	useEffect(() => {
		if (lang) setLanguage(lang);
	}, [lang, setLanguage]);

	// ?suggest and ?auto=connect press the room's own buttons once it is up.
	useEffect(() => {
		const press = (find) => {
			const timer = setInterval(() => {
				const button = find();
				if (!button) return;
				clearInterval(timer);
				button.click();
			}, 100);
			return timer;
		};
		const timers = [];
		if (PARAMS.has('suggest')) {
			// The visible suggest button, wherever the layout puts it; none when
			// the field is open already.
			timers.push(press(() => (document.querySelector('input.keep-open')
				? { click: () => {} }
				: [...document.querySelectorAll('button:has(svg.lucide-send)')].find(button => button.offsetParent))));
		}
		if (PARAMS.get('auto') === 'connect') {
			// The only button of the host's player while signed out.
			timers.push(press(() => document.getElementById('apple-music-video-container')?.parentElement?.querySelector('button')));
		}
		return () => timers.forEach(clearInterval);
	}, []);

	return (
		<ConsentContext.Provider value={consent}>
			<WebSocketContext.Provider value={socket}>
				<RoomBody />
			</WebSocketContext.Provider>
		</ConsentContext.Provider>
	);
}
