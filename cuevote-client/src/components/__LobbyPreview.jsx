// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// DEV-ONLY preview (route /__lobby-preview, gated by import.meta.env.DEV in
// main.jsx, not bundled in production). Renders the real Lobby without a
// backend: a mock socket answers LIST_ROOMS with YouTube and Apple Music
// channels, and the create dialog's Apple Music check is answered locally.
// A channel created here is added to the mock list instead of opening a room.
// Arrow keys and Enter drive the same focus a TV remote does.
//
// Query parameters:
//   ?create      open the create dialog right away
//   ?apple=0     a server without Apple Music: the dialog offers YouTube only
//   ?signedOut   a first visit: not signed in, cookies not accepted
//   ?conn=...    the connection: connecting, or problem (it does not come: the
//                card shows after 12 s). "Retry" connects.
//   ?offline     the device has no internet
//
// Thumbnails are generated SVGs, so the page loads nothing from YouTube or
// Apple, and the cookie banner stays closed without anything being accepted.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Lobby } from './Lobby';
import { WebSocketContext } from '../contexts/WebSocketContext';
import { ConsentContext } from '../contexts/ConsentContextValue';
import { Consent } from '../contexts/ConsentContext';
import { DEVELOPER_TOKEN_URL } from '../utils/musicKit';

const HOST = { id: 'preview-host', name: 'Alex', email: 'alex@example.com', picture: null };
// Before the lobby renders: it asks navigator.onLine while rendering.
if (new URLSearchParams(window.location.search).has('offline')) {
	Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
}
// What the lobby gives every channel it creates.
const COLOR = 'from-gray-700 to-black';

// Stage-light stand-ins for video thumbnails.
function thumbnail(base, glowA, glowB) {
	const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">'
		+ `<defs><radialGradient id="a" cx="22%" cy="18%" r="75%"><stop offset="0" stop-color="${glowA}"/><stop offset="1" stop-color="${glowA}" stop-opacity="0"/></radialGradient>`
		+ `<radialGradient id="b" cx="82%" cy="80%" r="70%"><stop offset="0" stop-color="${glowB}"/><stop offset="1" stop-color="${glowB}" stop-opacity="0"/></radialGradient></defs>`
		+ `<rect width="480" height="360" fill="${base}"/><rect width="480" height="360" fill="url(#a)"/><rect width="480" height="360" fill="url(#b)"/></svg>`;
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// Shaped like the server's ROOM_LIST entries. Apple channels never carry a
// track there, so they never have a thumbnail.
function channel(id, name, {
	provider = 'youtube', listeners = 0, active = listeners > 0, thumb = null, flag = 'international',
	isPublic = true, password = false, mine = false, host = 'Alex',
} = {}) {
	return {
		id,
		name,
		description: `Hosted by ${host}`,
		color: COLOR,
		listeners,
		currentTrack: thumb && provider !== 'apple' ? { thumbnail: thumb, title: 'Preview', artist: 'Preview' } : null,
		is_protected: password,
		isActive: active,
		language_flag: flag,
		provider,
		listedPublic: isPublic,
		mine,
	};
}

const CHANNELS = [
	channel('yt-rooftop', 'Rooftop Saturday', { listeners: 14, thumb: thumbnail('#1a0b2e', '#ff6a3d', '#6b2bd9'), flag: 'de', host: 'Mia' }),
	channel('am-late', 'Late Night Vibes', { provider: 'apple', listeners: 6, mine: true }),
	channel('yt-kitchen', 'WG-Party Küche', { listeners: 9, thumb: thumbnail('#120d0a', '#ef4444', '#f97316'), flag: 'at', host: 'Lukas', mine: true }),
	channel('yt-indie', 'Indie Dinner Party', { listeners: 3, thumb: thumbnail('#0b1d2e', '#2dd4bf', '#1e3a8a'), flag: 'fr', host: 'Léa' }),
	channel('yt-lofi', 'Lo-fi Study Session with Friends', { listeners: 2, thumb: thumbnail('#10151f', '#f59e0b', '#be185d'), flag: 'nl', host: 'Noor' }),
	channel('am-brunch', 'Sunday Brunch Jazz', { provider: 'apple', listeners: 1, flag: 'it', host: 'Giulia' }),
	channel('am-abiball', 'Abiball Afterparty 2026', { provider: 'apple', active: false, flag: 'de', host: 'Jonas' }),
	channel('yt-90s', '90s Throwback', { active: false, flag: 'gb', host: 'Sam' }),
	channel('am-birthday', 'Birthday Surprise', { provider: 'apple', isPublic: false, password: true, flag: 'de', mine: true }),
	channel('yt-office', 'Office Friday', { listeners: 4, thumb: thumbnail('#0a1410', '#22c55e', '#0ea5e9'), isPublic: false, password: true, host: 'Kim' }),
	channel('am-pregame', 'Pregame', { provider: 'apple', isPublic: false, password: true, flag: 'ch', host: 'Nico' }),
];

// The server's filters: private lists only channels with a password.
function listFor(channels, type) {
	if (type === 'my_channels') return channels.filter((c) => c.mine);
	if (type === 'private') return channels.filter((c) => !c.listedPublic && c.is_protected);
	return channels.filter((c) => c.listedPublic);
}

export default function LobbyPreview() {
	const params = useMemo(() => new URLSearchParams(window.location.search), []);
	const signedOut = params.has('signedOut');
	const appleOn = params.get('apple') !== '0';
	const openCreate = params.has('create');
	const connection = params.get('conn') || (params.has('offline') ? 'connecting' : '');

	const [channels, setChannels] = useState(CHANNELS);
	const [listType, setListType] = useState(null);
	const [lastMessage, setLastMessage] = useState(null);
	const [connected, setConnected] = useState(!connection);

	useEffect(() => {
		if (listType) setLastMessage({ type: 'ROOM_LIST', payload: listFor(channels, listType) });
	}, [channels, listType]);

	const sendMessage = useCallback((message) => {
		if (message.type === 'LIST_ROOMS') {
			setListType(message.payload?.type || 'public');
		} else if (message.type === 'CREATE_ROOM') {
			const p = message.payload;
			setChannels((current) => [
				channel(`new-${current.length}`, p.name, {
					provider: p.provider,
					listeners: 1,
					flag: p.languageFlag,
					isPublic: !p.isPrivate,
					password: Boolean(p.isPrivate && p.password),
					mine: true,
				}),
				...current,
			]);
		}
	}, []);

	const socket = useMemo(() => ({
		state: null,
		isConnected: connected,
		sendMessage,
		lastError: null,
		lastErrorCode: null,
		lastErrorTimestamp: 0,
		lastMessage,
		clientId: 'preview',
		user: signedOut ? null : HOST,
		handleLoginSuccess: () => {},
		handleLogout: () => {},
		clearMessage: () => setLastMessage(null),
		reconnectAttempt: connected ? 0 : (connection === 'problem' ? 5 : 0),
		forceReconnect: () => { setTimeout(() => setConnected(true), 1200); },
		connectionQuality: 'good',
		progressRef: { current: 0 },
		progressAtRef: { current: 0 },
		applePlayerLease: null,
	}), [sendMessage, lastMessage, signedOut, connected, connection]);

	// The cookie banner belongs to the real page around this one: keep it
	// closed. Nothing is accepted; the lobby below gets its own consent value.
	const outerConsent = Consent.useConsent();
	useEffect(() => {
		if (outerConsent.showBanner) outerConsent.setShowBanner(false);
	}, [outerConsent]);
	const consent = useMemo(() => ({
		...outerConsent,
		hasConsent: !signedOut,
		showBanner: false,
		askForConsent: () => {},
	}), [outerConsent, signedOut]);

	// The dialog offers Apple Music when the token route answers JSON.
	useLayoutEffect(() => {
		if (!appleOn) return undefined;
		const realFetch = window.fetch;
		window.fetch = (input, init) => {
			const url = typeof input === 'string' ? input : input?.url || '';
			if (url.endsWith(DEVELOPER_TOKEN_URL)) {
				return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
			}
			return realFetch.call(window, input, init);
		};
		return () => { window.fetch = realFetch; };
	}, [appleOn]);

	useEffect(() => {
		if (!openCreate || signedOut) return undefined;
		const timer = setTimeout(() => document.getElementById('lobby-item-0')?.click(), 150);
		return () => clearTimeout(timer);
	}, [openCreate, signedOut]);

	return (
		<ConsentContext.Provider value={consent}>
			<WebSocketContext.Provider value={socket}>
				<Lobby />
			</WebSocketContext.Provider>
		</ConsentContext.Provider>
	);
}
