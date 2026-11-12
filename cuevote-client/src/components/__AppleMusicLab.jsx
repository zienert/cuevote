// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// DEV-ONLY lab (route /__apple-music-lab, gated by import.meta.env.DEV in
// main.jsx, not bundled in production). Before any Apple Music room code is
// written, it answers per browser the two questions such a room depends on:
//   1. Does an Apple Music subscriber get full-length music videos here? The
//      videos are DRM-protected, and Apple documents no supported browsers.
//   2. Does the next video start without another click? CueVote's server clock
//      moves the queue on, so the host page has to start every track by
//      itself: mid-play (a skip, a vote that changes what is next) and after a
//      track has ended.
// The results come out as a JSON report to paste back. Nothing is stored; the
// page talks only to Apple and to the local developer-token endpoint.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	artworkUrl,
	configureMusicKit,
	describeMusicKitError,
	fetchDeveloperToken,
	playbackStateName,
} from '../utils/musicKit';

const LAB_VERSION = 'cuevote-apple-music-lab/1';
const DEFAULT_QUERY = 'Billie Eilish';
const SAMPLE_MS = 500;
const LOG_LIMIT = 300;
// The auto-advance test counts a video as started once it has played this long.
const CHAIN_PLAY_SECONDS = 8;
const CHAIN_STEP_TIMEOUT_MS = 30000;
// A preview is a snippet of about 30 s. A long duration that played past this
// point is the full item.
const FULL_LENGTH_MIN_DURATION = 60;
const FULL_LENGTH_MIN_REACHED = 35;

const KEY_SYSTEMS = [
	{ name: 'Widevine', keySystem: 'com.widevine.alpha' },
	{ name: 'PlayReady', keySystem: 'com.microsoft.playready.recommendation' },
	{ name: 'FairPlay', keySystem: 'com.apple.fps' },
];

// Every MusicKit event worth seeing. The per-tick ones (time, progress,
// buffer) are left out; the sampler reads those.
const LOGGED_EVENTS = [
	'authorizationStatusDidChange',
	'storefrontCountryCodeDidChange',
	'storefrontIdentifierDidChange',
	'queueIsReady',
	'queueItemsDidChange',
	'nowPlayingItemDidChange',
	'mediaItemStateDidChange',
	'playbackStateDidChange',
	'playerTypeDidChange',
	'playbackDurationDidChange',
	'playbackBitrateDidChange',
	'mediaElementCreated',
	'mediaPlaybackError',
	'drmUnsupported',
	'primaryPlayerDidChange',
	'playbackTargetAvailableDidChange',
	'eligibleForSubscribeView',
];

const ENDED_STATES = new Set(['ended', 'completed', 'stopped']);
const RUNNING_PHASES = new Set(['a', 'b', 'b-end', 'c']);
const IDLE_CHAIN = { phase: 'idle', items: [], deadline: 0, results: {} };

const REPORT_PLAY_FIELDS = [
	'n', 'id', 'kind', 'how', 'title', 'artist', 'catalogSeconds', 'previewOnlyFlag',
	'playingAfterMs', 'playedSeconds', 'maxTime', 'duration', 'video', 'drmFallback', 'error',
];

function describeBrowser() {
	const ua = navigator.userAgent;
	const version = (pattern) => (ua.match(pattern) || [])[1] || '';
	let browser = 'Unknown browser';
	if (/Edg\//.test(ua)) browser = `Edge ${version(/Edg\/([\d.]+)/)}`;
	else if (/Firefox\//.test(ua)) browser = `Firefox ${version(/Firefox\/([\d.]+)/)}`;
	else if (/Chrome\//.test(ua)) browser = `Chrome ${version(/Chrome\/([\d.]+)/)}`;
	else if (/Safari\//.test(ua)) browser = `Safari ${version(/Version\/([\d.]+)/)}`;
	let os = 'an unknown OS';
	if (/iPhone|iPad/.test(ua)) os = 'iOS';
	else if (/Windows/.test(ua)) os = 'Windows';
	else if (/Macintosh|Mac OS X/.test(ua)) os = 'macOS';
	else if (/Android/.test(ua)) os = 'Android';
	else if (/Linux/.test(ua)) os = 'Linux';
	return {
		name: `${browser.trim()} on ${os}`,
		userAgent: ua,
		secureContext: window.isSecureContext,
		eme: typeof navigator.requestMediaKeySystemAccess === 'function',
	};
}

async function probeKeySystems() {
	const found = [];
	for (const { name, keySystem } of KEY_SYSTEMS) {
		let supported = false;
		if (typeof navigator.requestMediaKeySystemAccess === 'function') {
			try {
				await navigator.requestMediaKeySystemAccess(keySystem, [{
					initDataTypes: ['cenc', 'sinf', 'skd'],
					audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
					videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }],
				}]);
				supported = true;
			} catch {
				supported = false;
			}
		}
		found.push({ name, keySystem, supported });
	}
	return found;
}

function formatTime(seconds) {
	if (!Number.isFinite(seconds) || seconds < 0) return '–';
	const whole = Math.floor(seconds);
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function itemInfo(item) {
	if (!item) return null;
	return {
		id: item.id != null ? String(item.id) : null,
		type: item.type || null,
		title: item.attributes?.name || item.title || null,
		artist: item.attributes?.artistName || item.artistName || null,
	};
}

// Event payloads can hold DOM nodes and cycles; keep one level of plain values.
function summarize(data) {
	if (data === undefined || data === null) return '';
	if (typeof data !== 'object') return String(data);
	if (data instanceof Error || data.errorCode) return describeMusicKitError(data);
	if (data instanceof HTMLElement) return `<${data.tagName.toLowerCase()}>`;
	const parts = [];
	for (const [key, value] of Object.entries(data).slice(0, 8)) {
		if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) parts.push(`${key}=${value}`);
		else if (value instanceof HTMLElement) parts.push(`${key}=<${value.tagName.toLowerCase()}>`);
		else if (value?.attributes?.name) parts.push(`${key}="${value.attributes.name}"`);
		else if (value?.id) parts.push(`${key}#${value.id}`);
	}
	return parts.join(' ');
}

function reportPlay(play) {
	const out = {};
	for (const field of REPORT_PLAY_FIELDS) {
		const value = play[field];
		out[field] = typeof value === 'number' && !Number.isInteger(value) ? Math.round(value * 10) / 10 : value;
	}
	return out;
}

function tone(result) {
	if (!result || result.startsWith('not tested')) return 'text-neutral-400';
	if (result === 'ok' || result.startsWith('yes')) return 'text-emerald-400';
	if (result.startsWith('picture')) return 'text-amber-300';
	return 'text-red-400';
}

function Card({ title, children, aside = null }) {
	return (
		<section className="rounded-2xl border border-white/10 bg-neutral-900/60 p-4">
			<div className="mb-3 flex items-center justify-between gap-3">
				<h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">{title}</h2>
				{aside}
			</div>
			{children}
		</section>
	);
}

function Button({ children, onClick, disabled = false, primary = false }) {
	const look = primary
		? 'bg-orange-600 text-white hover:bg-orange-500'
		: 'bg-white/10 text-neutral-100 hover:bg-white/15';
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${look} disabled:cursor-not-allowed disabled:opacity-40`}
		>
			{children}
		</button>
	);
}

function ResultRow({ item, onPlay, disabled }) {
	const attributes = item.attributes || {};
	const art = artworkUrl(attributes.artwork, 96);
	return (
		<li className="flex items-center gap-3 py-2">
			{art ? (
				<img src={art} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
			) : (
				<div className="h-12 w-12 shrink-0 rounded-md bg-white/5" />
			)}
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm text-neutral-100">{attributes.name}</div>
				<div className="truncate text-xs text-neutral-400">
					{attributes.artistName} · {formatTime((attributes.durationInMillis || 0) / 1000)}
					{attributes.has4K ? ' · 4K' : ''}
					{attributes.hasHDR ? ' · HDR' : ''}
					{attributes.playParams ? '' : ' · no playParams'}
					{' · #'}{item.id}
				</div>
			</div>
			<Button onClick={() => onPlay(item)} disabled={disabled}>Play</Button>
		</li>
	);
}

export default function AppleMusicLab() {
	const [browser] = useState(describeBrowser);
	const [drm, setDrm] = useState(null);
	const [setup, setSetup] = useState({ step: 'starting', error: null, code: null, version: null });
	// previewOnlyFlag is MusicKit's opt-in switch to force previews, not a
	// status: without sign-in MusicKit plays previews while it still reads false.
	const [auth, setAuth] = useState({ authorized: false, previewOnlyFlag: null, storefront: null });
	// MusicKit.configure() accepts any well-formed token; only the first
	// catalog request shows whether Apple takes it.
	const [tokenCheck, setTokenCheck] = useState('not checked yet');
	const [query, setQuery] = useState(DEFAULT_QUERY);
	const [results, setResults] = useState({ loading: false, error: null, term: '', videos: [], songs: [] });
	const [snapshot, setSnapshot] = useState(null);
	const [plays, setPlays] = useState([]);
	const [chain, setChain] = useState(IDLE_CHAIN);
	const [log, setLog] = useState([]);
	const [copied, setCopied] = useState(false);

	const musicRef = useRef(null);
	const containerRef = useRef(null);
	const createdVideoRef = useRef(null);
	const activePlayRef = useRef(null);
	const playCounterRef = useRef(0);
	const chainRef = useRef(IDLE_CHAIN);

	const ready = setup.step === 'ready';
	const chainRunning = RUNNING_PHASES.has(chain.phase);

	const addLog = useCallback((kind, text) => {
		const at = new Date().toISOString().slice(11, 23);
		setLog((prev) => [{ at, kind, text }, ...prev].slice(0, LOG_LIMIT));
	}, []);

	const refreshAuth = useCallback(() => {
		const music = musicRef.current;
		if (!music) return;
		setAuth({
			authorized: Boolean(music.isAuthorized),
			previewOnlyFlag: music.previewOnly ?? null,
			storefront: music.storefrontId || null,
		});
	}, []);

	const publishPlay = useCallback((record) => {
		const copy = { ...record };
		setPlays((prev) => prev.map((play) => (play.n === copy.n ? copy : play)));
	}, []);

	const updateChain = useCallback((next) => {
		chainRef.current = next;
		setChain(next);
	}, []);

	// MusicKit puts its <video> into #apple-music-video-container. Where it
	// really ends up is part of what this lab reports.
	const findVideoElement = useCallback(() => {
		const created = createdVideoRef.current;
		const container = containerRef.current;
		if (created && created.isConnected) {
			return { el: created, where: container?.contains(created) ? 'container' : 'elsewhere' };
		}
		const inContainer = container?.querySelector('video');
		if (inContainer) return { el: inContainer, where: 'container' };
		const anywhere = document.querySelector('video');
		return anywhere ? { el: anywhere, where: 'elsewhere' } : null;
	}, []);

	const search = useCallback(async (term) => {
		const music = musicRef.current;
		const trimmed = term.trim();
		if (!music || !trimmed) return;
		setResults((prev) => ({ ...prev, loading: true, error: null }));
		try {
			const { data } = await music.api.music('/v1/catalog/{{storefrontId}}/search', {
				term: trimmed,
				types: 'music-videos,songs',
				limit: 10,
			});
			const videos = data?.results?.['music-videos']?.data || [];
			const songs = data?.results?.songs?.data || [];
			setResults({ loading: false, error: null, term: trimmed, videos, songs });
			setTokenCheck('accepted by Apple');
			addLog('info', `Search "${trimmed}" in storefront ${music.storefrontId}: ${videos.length} videos, ${songs.length} songs`);
		} catch (err) {
			const message = describeMusicKitError(err);
			setResults({ loading: false, error: message, term: trimmed, videos: [], songs: [] });
			if (/UNAUTHORIZED|TOKEN|\b40[13]\b/i.test(message)) setTokenCheck(`rejected by Apple (${message})`);
			addLog('error', `Search failed: ${message}`);
		}
	}, [addLog]);

	const startPlay = useCallback(async (item, how) => {
		const music = musicRef.current;
		if (!music || !item) return;
		const previous = activePlayRef.current;
		if (previous && !previous.done) {
			previous.done = true;
			publishPlay(previous);
		}
		const kind = item.type === 'music-videos' ? 'video' : 'song';
		playCounterRef.current += 1;
		const record = {
			n: playCounterRef.current,
			id: String(item.id),
			kind,
			how,
			title: item.attributes?.name || null,
			artist: item.attributes?.artistName || null,
			catalogSeconds: item.attributes?.durationInMillis ? Math.round(item.attributes.durationInMillis / 1000) : null,
			previewOnlyFlag: music.previewOnly ?? null,
			requestedAt: Date.now(),
			playingAfterMs: null,
			playedSeconds: 0,
			maxTime: 0,
			duration: null,
			video: null,
			drmFallback: false,
			error: null,
			done: false,
			lastTime: null,
		};
		activePlayRef.current = record;
		setPlays((prev) => [...prev, { ...record }]);
		addLog('info', `${how === 'click' ? 'Started by click' : 'Started without a click'}: ${kind} "${record.title}" #${record.id}`);
		try {
			await music.setQueue(kind === 'video' ? { musicVideo: record.id } : { song: record.id });
			await music.play();
		} catch (err) {
			record.error = describeMusicKitError(err);
			addLog('error', `Starting #${record.id} failed: ${record.error}`);
			publishPlay(record);
		}
	}, [addLog, publishPlay]);

	// The auto-advance test, stepped by the sampler, never by a click: the
	// first video starts from the click on "Run test", the second replaces it
	// mid-play, the third starts once the second has ended.
	const stepChain = useCallback((snap) => {
		const current = chainRef.current;
		if (!RUNNING_PHASES.has(current.phase)) return;
		const music = musicRef.current;
		const record = activePlayRef.current;
		const now = Date.now();
		const recordFor = (item) => (record && item && record.id === String(item.id) ? record : null);
		const stop = (key, reason) => {
			updateChain({ ...current, phase: 'failed', results: { ...current.results, [key]: reason } });
			addLog('error', `Auto-advance test stopped: ${reason}`);
		};
		// An error alone does not fail a step: switching items can raise one for
		// the item being replaced. A step fails only when its video has not
		// played long enough by the deadline, and then names the last error.
		const tooSlow = (played) => `failed: ${played?.error || `did not play for ${CHAIN_PLAY_SECONDS} s`} `
			+ `within ${CHAIN_STEP_TIMEOUT_MS / 1000} s (state ${snap.state})`;

		if (current.phase === 'a') {
			const played = recordFor(current.items[0]);
			if (played && played.playedSeconds >= CHAIN_PLAY_SECONDS) {
				updateChain({
					...current,
					phase: 'b',
					deadline: now + CHAIN_STEP_TIMEOUT_MS,
					results: { ...current.results, firstVideo: 'ok' },
				});
				startPlay(current.items[1], 'auto');
				return;
			}
			if (now > current.deadline) stop('firstVideo', tooSlow(played));
			return;
		}

		if (current.phase === 'b') {
			const played = recordFor(current.items[1]);
			if (played && played.playedSeconds >= CHAIN_PLAY_SECONDS) {
				const results = { ...current.results, switchMidPlay: 'ok' };
				if (!(snap.duration > CHAIN_PLAY_SECONDS + 6)) {
					updateChain({
						...current,
						phase: 'failed',
						results: { ...results, startAfterEnd: 'not tested: the duration is unknown, so the end cannot be reached' },
					});
					return;
				}
				updateChain({ ...current, phase: 'b-end', deadline: now + CHAIN_STEP_TIMEOUT_MS, results });
				const target = snap.duration - 4;
				addLog('info', `Seeking to ${formatTime(target)} to reach the end`);
				Promise.resolve(music.seekToTime(target)).catch((err) => {
					addLog('error', `seekToTime failed: ${describeMusicKitError(err)}`);
				});
				return;
			}
			if (now > current.deadline) stop('switchMidPlay', tooSlow(played));
			return;
		}

		if (current.phase === 'b-end') {
			const ended = ENDED_STATES.has(snap.state)
				|| (!snap.isPlaying && snap.duration > 0 && snap.time >= snap.duration - 1.5);
			if (ended) {
				updateChain({ ...current, phase: 'c', deadline: now + CHAIN_STEP_TIMEOUT_MS });
				addLog('info', `The second video ended (state ${snap.state}); starting the third without a click`);
				startPlay(current.items[2], 'auto');
				return;
			}
			if (now > current.deadline) stop('startAfterEnd', `not tested: the second video never ended (state ${snap.state})`);
			return;
		}

		if (current.phase === 'c') {
			const played = recordFor(current.items[2]);
			if (played && played.playedSeconds >= CHAIN_PLAY_SECONDS) {
				updateChain({ ...current, phase: 'done', results: { ...current.results, startAfterEnd: 'ok' } });
				addLog('info', 'Auto-advance test passed');
				music.pause();
				return;
			}
			if (now > current.deadline) stop('startAfterEnd', tooSlow(played));
		}
	}, [addLog, startPlay, updateChain]);

	const attachListeners = useCallback((music) => {
		const MusicKit = window.MusicKit;
		const handlers = LOGGED_EVENTS.map((name) => {
			const handler = (data) => {
				let kind = 'event';
				let text = summarize(data);
				if (name === 'playbackStateDidChange') {
					text = `${playbackStateName(MusicKit, data?.oldState)} → ${playbackStateName(MusicKit, data?.state)}`;
				} else if (name === 'nowPlayingItemDidChange') {
					const info = itemInfo(data?.item);
					text = info ? `"${info.title}" (${info.type}) #${info.id}` : 'none';
				} else if (name === 'mediaElementCreated') {
					const el = data instanceof HTMLElement ? data : (data?.element || data?.target || null);
					if (el instanceof HTMLVideoElement) createdVideoRef.current = el;
					text = el instanceof HTMLElement ? `<${el.tagName.toLowerCase()}>` : summarize(data);
				} else if (name === 'mediaPlaybackError' || name === 'drmUnsupported') {
					kind = 'error';
					const record = activePlayRef.current;
					if (name === 'mediaPlaybackError') text = describeMusicKitError(data?.error || data);
					if (record && !record.done) {
						if (name === 'drmUnsupported') record.drmFallback = true;
						else record.error = text;
						publishPlay(record);
					}
				} else if (name === 'primaryPlayerDidChange') {
					kind = 'warn';
				}
				if (name === 'authorizationStatusDidChange' || name.startsWith('storefront')) refreshAuth();
				addLog(kind, text ? `${name}: ${text}` : name);
			};
			music.addEventListener(name, handler);
			return [name, handler];
		});
		return () => handlers.forEach(([name, handler]) => music.removeEventListener(name, handler));
	}, [addLog, publishPlay, refreshAuth]);

	useEffect(() => {
		let cancelled = false;
		let detach = null;
		probeKeySystems().then((found) => {
			if (!cancelled) setDrm(found);
		});
		(async () => {
			try {
				setSetup({ step: 'token', error: null, code: null, version: null });
				const { token } = await fetchDeveloperToken();
				if (cancelled) return;
				setSetup({ step: 'musickit', error: null, code: null, version: null });
				const music = await configureMusicKit({ developerToken: token, build: LAB_VERSION });
				if (cancelled) return;
				musicRef.current = music;
				detach = attachListeners(music);
				// Not documented, but if MusicKit would keep playing related
				// music after the queue, that is not ours to allow: the queue
				// belongs to the room.
				if (music.autoplayEnabled === true) {
					music.autoplayEnabled = false;
					addLog('info', 'Turned MusicKit autoplay off');
				}
				const version = window.MusicKit?.version || null;
				setSetup({ step: 'ready', error: null, code: null, version });
				refreshAuth();
				addLog('info', `MusicKit ${version || ''} ready: storefront ${music.storefrontId}, ${music.isAuthorized ? 'signed in' : 'not signed in'}`);
				search(DEFAULT_QUERY);
			} catch (err) {
				if (cancelled) return;
				setSetup({ step: 'failed', error: describeMusicKitError(err), code: err?.code || null, version: null });
				addLog('error', `Setup failed: ${describeMusicKitError(err)}`);
			}
		})();
		return () => {
			cancelled = true;
			if (detach) detach();
		};
	}, [addLog, attachListeners, refreshAuth, search]);

	// Twice a second: what MusicKit says, what the <video> shows, and the
	// next step of the auto-advance test.
	useEffect(() => {
		if (!ready) return undefined;
		const timer = setInterval(() => {
			const music = musicRef.current;
			if (!music) return;
			const found = findVideoElement();
			const snap = {
				state: playbackStateName(window.MusicKit, music.playbackState),
				isPlaying: Boolean(music.isPlaying),
				time: Number(music.currentPlaybackTime) || 0,
				duration: Number(music.currentPlaybackDuration) || 0,
				item: itemInfo(music.nowPlayingItem),
				video: found ? { width: found.el.videoWidth || 0, height: found.el.videoHeight || 0, where: found.where } : null,
			};
			setSnapshot(snap);

			const record = activePlayRef.current;
			if (record && !record.done) {
				// Count only time of the item this record asked for: right after
				// a switch MusicKit still reports the previous one for a moment.
				const sameItem = snap.item
					&& (snap.item.id === record.id || (snap.item.title && snap.item.title === record.title));
				if (sameItem) {
					if (record.lastTime !== null && snap.isPlaying) {
						const delta = snap.time - record.lastTime;
						if (delta > 0 && delta < 2) record.playedSeconds += delta;
					}
					record.lastTime = snap.time;
					if (snap.isPlaying && record.playingAfterMs === null) record.playingAfterMs = Date.now() - record.requestedAt;
					record.maxTime = Math.max(record.maxTime, snap.time);
					if (snap.duration) record.duration = Math.round(snap.duration);
					if (snap.video?.width && (!record.video || snap.video.width > record.video.width)) record.video = snap.video;
				}
				publishPlay(record);
			}
			stepChain(snap);
		}, SAMPLE_MS);
		return () => clearInterval(timer);
	}, [ready, findVideoElement, publishPlay, stepChain]);

	const signIn = async () => {
		const music = musicRef.current;
		if (!music) return;
		try {
			const userToken = await music.authorize();
			addLog(userToken ? 'info' : 'warn', userToken ? 'Signed in to Apple Music' : 'Sign-in was cancelled or did not complete');
		} catch (err) {
			addLog('error', `Sign-in failed: ${describeMusicKitError(err)}`);
		}
		refreshAuth();
		if (results.term) search(results.term);
	};

	const signOut = async () => {
		const music = musicRef.current;
		if (!music) return;
		try {
			await music.unauthorize();
			addLog('info', 'Signed out of Apple Music');
		} catch (err) {
			addLog('error', `Sign-out failed: ${describeMusicKitError(err)}`);
		}
		refreshAuth();
	};

	const control = async (label, action) => {
		const music = musicRef.current;
		if (!music) return;
		try {
			await action(music);
			addLog('info', label);
		} catch (err) {
			addLog('error', `${label} failed: ${describeMusicKitError(err)}`);
		}
	};

	const runChain = () => {
		const items = results.videos.slice(0, 3);
		if (items.length < 3) return;
		updateChain({ phase: 'a', items, deadline: Date.now() + CHAIN_STEP_TIMEOUT_MS, results: {} });
		addLog('info', 'Auto-advance test started');
		startPlay(items[0], 'click');
	};

	const verdict = useMemo(() => {
		const videoPlays = plays.filter((play) => play.kind === 'video');
		const full = videoPlays.find((play) => !play.error && !play.drmFallback
			&& (play.duration || 0) >= FULL_LENGTH_MIN_DURATION
			&& play.maxTime >= FULL_LENGTH_MIN_REACHED
			&& play.video?.width > 0);
		let fullLengthVideo = 'not tested';
		if (full) fullLengthVideo = `yes (${full.video.width}×${full.video.height}, ${formatTime(full.duration)})`;
		else if (videoPlays.some((play) => play.video?.width > 0)) fullLengthVideo = 'picture, but no full length yet (a preview, or not played past 0:35)';
		else if (videoPlays.length) fullLengthVideo = 'no picture yet';
		return {
			fullLengthVideo,
			nextWithoutClickMidPlay: chain.results.switchMidPlay || 'not tested',
			nextWithoutClickAfterEnd: chain.results.startAfterEnd || 'not tested',
		};
	}, [plays, chain.results]);

	const report = useMemo(() => ({
		lab: LAB_VERSION,
		browser,
		drm,
		musicKit: { version: setup.version, setup: setup.step, error: setup.error, developerToken: tokenCheck, ...auth },
		verdict,
		autoAdvanceTest: { phase: chain.phase, ...chain.results },
		plays: plays.map(reportPlay),
		errors: log.filter((entry) => entry.kind === 'error').slice(0, 20),
		log: log.slice(0, 80),
	}), [browser, drm, setup, tokenCheck, auth, verdict, chain, plays, log]);

	const copyReport = async () => {
		const text = JSON.stringify({ ...report, at: new Date().toISOString() }, null, 2);
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			addLog('warn', 'The clipboard is blocked: open "Show JSON" and copy the report by hand');
		}
	};

	const setupText = {
		starting: 'Starting…',
		token: 'Fetching the developer token from the server…',
		musickit: 'Loading MusicKit JS from Apple…',
		ready: `MusicKit ${setup.version || ''} is ready`,
		failed: 'Setup failed',
	}[setup.step];

	let setupHint = null;
	if (setup.step === 'failed') {
		setupHint = setup.code === 'APPLE_MUSIC_DISABLED'
			? 'Set APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID and APPLE_MUSIC_PRIVATE_KEY_PATH in cuevote-server/.env and restart the server, then reload.'
			: 'Check that js-cdn.music.apple.com is reachable from this browser (network, content blockers).';
	}

	const chainSteps = [
		['firstVideo', 'First video, started by your click'],
		['switchMidPlay', 'Second video replaces the first mid-play, no click'],
		['startAfterEnd', 'Third video starts after the second ended, no click'],
	];

	return (
		<div className="min-h-[100dvh] bg-[#050505] text-neutral-200">
			<div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
				<header className="space-y-1">
					<div className="flex flex-wrap items-center gap-2">
						<h1 className="text-2xl font-bold tracking-tight text-white">Apple Music lab</h1>
						<span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-xs font-semibold text-orange-400">dev only</span>
					</div>
					<p className="text-sm text-neutral-400">
						Does {browser.name} play full-length Apple Music videos, and start the next one without a click?
						Sign in with a subscriber account, play a video, run the auto-advance test, then copy the report.
					</p>
				</header>

				<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
					<div className="min-w-0 space-y-4">
						<Card title="Player">
							<div
								id="apple-music-video-container"
								ref={containerRef}
								className="aspect-video w-full overflow-hidden rounded-xl bg-black [&_video]:h-full [&_video]:w-full [&_video]:object-contain"
							/>
							<div className="mt-3 space-y-1 text-sm">
								<div className="truncate text-neutral-100">
									{snapshot?.item ? `${snapshot.item.title} – ${snapshot.item.artist}` : 'Nothing loaded'}
								</div>
								<div className="text-xs text-neutral-400">
									{snapshot ? `${snapshot.state} · ${formatTime(snapshot.time)} / ${formatTime(snapshot.duration)}` : '–'}
									{snapshot?.item?.type ? ` · ${snapshot.item.type}` : ''}
									{snapshot?.video
										? ` · <video> ${snapshot.video.width}×${snapshot.video.height} (${snapshot.video.where === 'container' ? 'in the container' : 'outside the container'})`
										: ' · no <video> element'}
								</div>
							</div>
							<div className="mt-3 flex flex-wrap gap-2">
								<Button disabled={!ready} onClick={() => control('Play', (music) => music.play())}>Play</Button>
								<Button disabled={!ready} onClick={() => control('Pause', (music) => music.pause())}>Pause</Button>
								<Button
									disabled={!ready}
									onClick={() => control('Seek +30 s', (music) => music.seekToTime((Number(music.currentPlaybackTime) || 0) + 30))}
								>
									+30 s
								</Button>
								<Button
									disabled={!ready}
									onClick={() => control('Seek to 10 s before the end', (music) => music.seekToTime(Math.max(0, (Number(music.currentPlaybackDuration) || 0) - 10)))}
								>
									End −10 s
								</Button>
								<Button disabled={!ready} onClick={() => control('Stop', (music) => music.stop())}>Stop</Button>
							</div>
						</Card>

						<Card title="Apple Music catalog">
							<form
								className="flex gap-2"
								onSubmit={(event) => {
									event.preventDefault();
									search(query);
								}}
							>
								<input
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									placeholder="Artist or title"
									className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-orange-500/60"
								/>
								<Button primary disabled={!ready || results.loading} onClick={() => search(query)}>
									{results.loading ? 'Searching…' : 'Search'}
								</Button>
							</form>
							{results.error ? <p className="mt-3 text-sm text-red-400">{results.error}</p> : null}
							<div className="mt-3 grid gap-4 xl:grid-cols-2">
								<div>
									<h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Music videos ({results.videos.length})</h3>
									<ul className="divide-y divide-white/5">
										{results.videos.map((item) => (
											<ResultRow key={item.id} item={item} disabled={!ready || chainRunning} onPlay={(picked) => startPlay(picked, 'click')} />
										))}
									</ul>
								</div>
								<div>
									<h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Songs ({results.songs.length})</h3>
									<ul className="divide-y divide-white/5">
										{results.songs.map((item) => (
											<ResultRow key={item.id} item={item} disabled={!ready || chainRunning} onPlay={(picked) => startPlay(picked, 'click')} />
										))}
									</ul>
								</div>
							</div>
						</Card>
					</div>

					<div className="min-w-0 space-y-4">
						<Card title="Report" aside={<Button primary onClick={copyReport}>{copied ? 'Copied' : 'Copy report'}</Button>}>
							<dl className="space-y-2 text-sm">
								<div>
									<dt className="text-neutral-400">Full-length music video</dt>
									<dd className={tone(verdict.fullLengthVideo)}>{verdict.fullLengthVideo}</dd>
								</div>
								<div>
									<dt className="text-neutral-400">Next video mid-play, no click</dt>
									<dd className={tone(verdict.nextWithoutClickMidPlay)}>{verdict.nextWithoutClickMidPlay}</dd>
								</div>
								<div>
									<dt className="text-neutral-400">Next video after the end, no click</dt>
									<dd className={tone(verdict.nextWithoutClickAfterEnd)}>{verdict.nextWithoutClickAfterEnd}</dd>
								</div>
							</dl>
							<details className="mt-3">
								<summary className="cursor-pointer text-xs text-neutral-400">Show JSON</summary>
								<pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-black/50 p-2 text-[11px] leading-snug text-neutral-300">
									{JSON.stringify(report, null, 2)}
								</pre>
							</details>
						</Card>

						<Card title="Apple Music">
							<p className={`text-sm ${setup.step === 'failed' ? 'text-red-400' : 'text-neutral-200'}`}>{setupText}</p>
							{setup.error ? <p className="mt-1 break-words text-xs text-red-300">{setup.error}</p> : null}
							{setupHint ? <p className="mt-1 text-xs text-neutral-400">{setupHint}</p> : null}
							{ready ? (
								<div className="mt-3 space-y-2 text-sm">
									<div className={tokenCheck.startsWith('accepted') ? 'text-emerald-400' : tokenCheck.startsWith('rejected') ? 'text-red-400' : 'text-neutral-400'}>
										Developer token {tokenCheck}
									</div>
									{tokenCheck.startsWith('rejected') ? (
										<p className="text-xs text-neutral-400">
											Check APPLE_MUSIC_TEAM_ID and APPLE_MUSIC_KEY_ID, and that the key has Media Services (MusicKit) enabled.
										</p>
									) : null}
									<div className="text-neutral-300">
										{auth.authorized ? 'Signed in' : 'Not signed in'} · storefront {auth.storefront || '–'}
									</div>
									{!auth.authorized ? (
										<p className="text-xs text-amber-300">
											Without signing in, Apple Music plays previews only. Sign in with an account that has a subscription.
										</p>
									) : null}
									<div className="flex gap-2">
										{auth.authorized
											? <Button onClick={signOut}>Sign out</Button>
											: <Button primary onClick={signIn}>Sign in to Apple Music</Button>}
									</div>
								</div>
							) : null}
						</Card>

						<Card title="Auto-advance test">
							<p className="text-xs text-neutral-400">
								Uses the first three music videos of the search. Each must play for {CHAIN_PLAY_SECONDS} s; the
								second is skipped to its end so the third can start once it has ended.
							</p>
							<ol className="mt-3 space-y-1 text-sm">
								{chainSteps.map(([key, label]) => (
									<li key={key} className="flex justify-between gap-3">
										<span className="text-neutral-300">{label}</span>
										<span className={`shrink-0 text-right ${tone(chain.results[key])}`}>
											{chain.results[key] || (chainRunning ? '…' : '–')}
										</span>
									</li>
								))}
							</ol>
							<div className="mt-3 flex items-center gap-3">
								<Button primary disabled={!ready || chainRunning || results.videos.length < 3} onClick={runChain}>
									{chainRunning ? 'Running…' : 'Run test'}
								</Button>
								{results.videos.length < 3 && ready ? (
									<span className="text-xs text-neutral-500">Needs three music videos in the search</span>
								) : null}
							</div>
						</Card>

						<Card title="Browser">
							<div className="space-y-1 text-sm">
								<div className="text-neutral-100">{browser.name}</div>
								<div className="text-xs text-neutral-400">
									secure context {browser.secureContext ? 'yes' : 'no'} · EME {browser.eme ? 'yes' : 'no'}
								</div>
								<ul className="mt-2 space-y-0.5 text-xs">
									{(drm || KEY_SYSTEMS).map((entry) => (
										<li key={entry.keySystem} className="flex justify-between">
											<span className="text-neutral-300">{entry.name}</span>
											<span className={entry.supported === undefined ? 'text-neutral-500' : entry.supported ? 'text-emerald-400' : 'text-neutral-500'}>
												{entry.supported === undefined ? 'checking…' : entry.supported ? 'available' : 'not available'}
											</span>
										</li>
									))}
								</ul>
							</div>
						</Card>
					</div>
				</div>

				<Card title={`Event log (${log.length})`}>
					<ol className="max-h-80 space-y-0.5 overflow-auto font-mono text-[11px] leading-snug">
						{log.map((entry, index) => (
							<li
								key={`${entry.at}-${index}`}
								className={entry.kind === 'error' ? 'text-red-300' : entry.kind === 'warn' ? 'text-amber-300' : entry.kind === 'event' ? 'text-neutral-400' : 'text-neutral-200'}
							>
								<span className="text-neutral-600">{entry.at}</span> {entry.text}
							</li>
						))}
					</ol>
				</Card>
			</div>
		</div>
	);
}
