// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLatestRef } from './useLatestRef';
import { configureMusicKit, fetchDeveloperToken } from '../utils/musicKit';
import { parseTrackKey } from '../utils/trackKeys';

// A guest's preview of an Apple Music item in an Apple channel. Apple lets
// MusicKit play short previews without an account; they must be played by
// MusicKit itself, so this never touches the preview files. previewOnly holds
// even for a guest signed in with a subscription: a preview never becomes a
// full stream that could compete with the host's.
//
// status: idle | loading | playing | paused | needs-start | error

const START_CHECK_MS = 2500;

function isAutoplayRefusal(err) {
	const code = err?.errorCode || err?.code || err?.name;
	return code === 'NotAllowedError' || code === 'USER_INTERACTION_REQUIRED';
}

export function useApplePreview({ track, volume, onEnded }) {
	const [music, setMusic] = useState(null);
	const [status, setStatus] = useState('idle');
	const onEndedRef = useLatestRef(onEnded);
	const loadingKeyRef = useRef(null);

	const key = track?.videoId || null;
	const parsed = parseTrackKey(key);
	const kind = parsed?.provider === 'apple' ? parsed.kind : null;
	const id = parsed?.provider === 'apple' ? parsed.id : null;

	// Load and set up MusicKit the first time something is previewed; a failed
	// load is tried again with the next preview.
	useEffect(() => {
		if (music) return undefined;
		if (!kind) {
			setStatus('idle');
			return undefined;
		}
		let cancelled = false;
		setStatus('loading');
		(async () => {
			try {
				const { token } = await fetchDeveloperToken();
				const instance = await configureMusicKit({ developerToken: token });
				if (cancelled) return;
				instance.previewOnly = true;
				if (instance.autoplayEnabled) instance.autoplayEnabled = false;
				setMusic(instance);
			} catch {
				if (!cancelled) setStatus('error');
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [key, kind, music]);

	// Follow MusicKit: playing, paused, ended (which closes the preview).
	useEffect(() => {
		if (!music) return undefined;
		const states = window.MusicKit?.PlaybackStates || {};
		const onState = () => {
			if (!loadingKeyRef.current) return;
			const state = music.playbackState;
			if (state === states.playing) setStatus('playing');
			else if (state === states.paused) setStatus(prev => (prev === 'needs-start' ? prev : 'paused'));
			else if (state === states.ended || state === states.completed) onEndedRef.current?.();
		};
		const onError = () => {
			if (loadingKeyRef.current) setStatus('error');
		};
		music.addEventListener('playbackStateDidChange', onState);
		music.addEventListener('mediaPlaybackError', onError);
		return () => {
			music.removeEventListener('playbackStateDidChange', onState);
			music.removeEventListener('mediaPlaybackError', onError);
		};
	}, [music, onEndedRef]);

	// Play the item asked for; stop when the preview closes.
	useEffect(() => {
		if (!music) return undefined;
		if (!kind || !id) {
			loadingKeyRef.current = null;
			try { music.stop(); } catch { /* nothing loaded */ }
			setStatus('idle');
			return undefined;
		}
		let cancelled = false;
		loadingKeyRef.current = key;
		setStatus('loading');
		(async () => {
			try {
				music.previewOnly = true;
				await music.setQueue({ [kind]: id, startPlaying: false });
				if (cancelled) return;
				await music.play();
				// A browser may refuse sound without a fresh click and still
				// resolve play(): check that the preview really plays.
				await new Promise(resolve => setTimeout(resolve, START_CHECK_MS));
				if (!cancelled && music.playbackState !== window.MusicKit?.PlaybackStates?.playing) {
					setStatus(prev => (prev === 'loading' ? 'needs-start' : prev));
				}
			} catch (err) {
				if (!cancelled) setStatus(isAutoplayRefusal(err) ? 'needs-start' : 'error');
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [music, kind, id, key]);

	// Leaving the room stops a running preview.
	useEffect(() => () => {
		try { music?.stop(); } catch { /* nothing loaded */ }
	}, [music]);

	useEffect(() => {
		if (!music) return;
		try {
			music.volume = Math.min(1, Math.max(0, Number(volume) || 0));
		} catch { /* not ready yet */ }
	}, [music, volume]);

	// The guest's tap when the browser refused to start on its own.
	const start = useCallback(() => {
		if (!music) return;
		setStatus('loading');
		Promise.resolve(music.play()).catch(() => setStatus('error'));
	}, [music]);

	return { status, start, kind };
}
