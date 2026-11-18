// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import { useSyncExternalStore } from 'react';

// How long the Android app keeps an Apple Music channel ready in the
// background while it is paused (the app's PlaybackService), chosen on this
// device. The choice lives in this device's storage, and the app learns it
// from <html data-apple-standby>, which it reads in the main frame next to
// data-apple-player: minutes, or "channel" for as long as the channel stays
// open. A frame cannot set it.

const STORAGE_KEY = 'cuevote_apple_standby';
const MARK = 'data-apple-standby';

// Minutes, or "channel": until the channel is left.
export const STANDBY_CHOICES = ['120', '480', 'channel'];
// What the app waits without a choice.
export const DEFAULT_STANDBY = '120';

/**
 * Whether this is the Android app that keeps a paused channel ready, the
 * only place the choice means anything. The iPhone app puts a CueVoteAndroid
 * object on the page as well, without this function, and so do Android apps
 * from before the choice.
 */
export function appKeepsChannelReady() {
	try {
		return typeof window !== 'undefined' && window.CueVoteAndroid?.keepsChannelReady?.() === true;
	} catch {
		return false;
	}
}

function readStored() {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (STANDBY_CHOICES.includes(stored)) return stored;
	} catch { /* site data blocked: the default holds */ }
	return DEFAULT_STANDBY;
}

let current = readStored();
const listeners = new Set();

/** Tells the app the choice. Run once at startup; the choice itself repeats it. */
export function markAppleStandby() {
	if (appKeepsChannelReady()) document.documentElement.setAttribute(MARK, current);
}

export function setAppleStandby(choice) {
	if (!STANDBY_CHOICES.includes(choice) || choice === current) return;
	current = choice;
	try {
		localStorage.setItem(STORAGE_KEY, choice);
	} catch { /* the choice holds until the page closes */ }
	markAppleStandby();
	listeners.forEach((listener) => listener());
}

function subscribe(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** The choice on this device, kept current. */
export function useAppleStandby() {
	return useSyncExternalStore(subscribe, () => current);
}
