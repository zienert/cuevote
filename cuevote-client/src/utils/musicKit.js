// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
//
// MusicKit on the Web (v3) plumbing for everything that plays Apple Music.
//
// MusicKit JS loads from Apple's CDN as a stand-alone script. DPLA §3.3.6(D)
// forbids recombining it with other code or re-hosting it, so it is never
// bundled, copied into this repo or served from cuevote.com.

export const MUSICKIT_SCRIPT_URL = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
export const DEVELOPER_TOKEN_URL = '/api/apple-music/developer-token';

const SCRIPT_READY_TIMEOUT_MS = 20000;

/**
 * Fetches the developer token the server signs: { token, expiresAt }.
 * Throws an Error with code 'APPLE_MUSIC_DISABLED' when the server has no
 * MusicKit key configured.
 */
export async function fetchDeveloperToken() {
	let response;
	try {
		response = await fetch(DEVELOPER_TOKEN_URL, { cache: 'no-store' });
	} catch {
		throw new Error('The server cannot be reached for an Apple Music developer token');
	}
	let body = null;
	try {
		body = await response.json();
	} catch {
		// not JSON: handled below by status
	}
	if (response.status === 404 && body?.error === 'apple_music_disabled') {
		const err = new Error('The server has no MusicKit key (APPLE_MUSIC_* in cuevote-server/.env)');
		err.code = 'APPLE_MUSIC_DISABLED';
		throw err;
	}
	if (!response.ok || typeof body?.token !== 'string') {
		throw new Error(`The developer token request failed (HTTP ${response.status})`);
	}
	return body;
}

let scriptPromise = null;

/** Loads MusicKit JS once and resolves with window.MusicKit once it is ready. */
export function loadMusicKit() {
	if (scriptPromise) return scriptPromise;
	scriptPromise = new Promise((resolve, reject) => {
		if (window.MusicKit) {
			resolve(window.MusicKit);
			return;
		}
		let timer = null;
		const onReady = () => {
			clearTimeout(timer);
			resolve(window.MusicKit);
		};
		const fail = (message) => {
			clearTimeout(timer);
			document.removeEventListener('musickitloaded', onReady);
			scriptPromise = null;
			reject(new Error(message));
		};
		document.addEventListener('musickitloaded', onReady, { once: true });
		timer = setTimeout(() => fail('MusicKit JS loaded but never reported ready'), SCRIPT_READY_TIMEOUT_MS);
		const script = document.createElement('script');
		script.src = MUSICKIT_SCRIPT_URL;
		script.async = true;
		script.onerror = () => fail('MusicKit JS could not be loaded from Apple');
		document.head.appendChild(script);
	});
	return scriptPromise;
}

let instancePromise = null;

/**
 * Configures the MusicKit singleton once and resolves with the instance.
 * A failed configuration may be retried by calling this again.
 */
export function configureMusicKit({ developerToken, appName = 'CueVote', build }) {
	if (instancePromise) return instancePromise;
	instancePromise = (async () => {
		const MusicKit = await loadMusicKit();
		// MusicKit would otherwise put its own modal over the page on every
		// playback error (on the host's party screen, too). The players here
		// handle errors themselves.
		await MusicKit.configure({ developerToken, app: { name: appName, build }, suppressErrorDialog: true });
		return MusicKit.getInstance();
	})();
	instancePromise.catch(() => {
		instancePromise = null;
	});
	return instancePromise;
}

/** "CODE: message" for whatever MusicKit or the browser throws. */
export function describeMusicKitError(err) {
	if (!err) return 'unknown error';
	if (typeof err === 'string') return err;
	const code = err.errorCode || err.code || (err.name !== 'Error' ? err.name : null);
	const message = err.description || err.message || String(err);
	if (!code || String(message).startsWith(String(code))) return String(message);
	return `${code}: ${message}`;
}

/** The name of a MusicKit.PlaybackStates value, e.g. 2 -> "playing". */
export function playbackStateName(MusicKit, state) {
	const states = MusicKit?.PlaybackStates;
	if (!states) return String(state);
	if (typeof states[state] === 'string') return states[state];
	const entry = Object.entries(states).find(([, value]) => value === state);
	return entry ? entry[0] : String(state);
}

/** A sized URL from an Apple Music artwork object ({ url: '…/{w}x{h}bb.jpg' }). */
export function artworkUrl(artwork, size) {
	if (!artwork?.url) return null;
	return artwork.url.replace('{w}', String(size)).replace('{h}', String(size)).replace('{f}', 'jpg');
}
