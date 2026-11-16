// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// PROPOSALS ONLY (branch apple-volume-proposals, not for merge). Which proposal
// for the loudness controls of an Apple Music channel the room renders. The
// room preview's picker sets it; everywhere else it stays 'today', which is
// the behaviour of main.
//
//   today   the mute button stays everywhere, whether it changes anything or not
//   tidy    no loudness control where it cannot change what is heard
//   hint    as tidy, and the room says once where the volume is set
//   mute    the mute button stays on a device with a locked volume and mutes
import { useSyncExternalStore } from 'react';

export const VOLUME_PROPOSALS = ['today', 'tidy', 'hint', 'mute'];

let current = 'today';
const listeners = new Set();

export const volumeProposal = {
	get: () => current,
	set(next) {
		if (!VOLUME_PROPOSALS.includes(next) || next === current) return;
		current = next;
		listeners.forEach(listener => listener());
	},
	subscribe(listener) {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
};

export function useVolumeProposal() {
	return useSyncExternalStore(volumeProposal.subscribe, volumeProposal.get);
}

// The two lines the 'hint' proposal adds. Kept here, not in the 35 locale
// files, until a proposal is chosen.
const HINT_TEXT = {
	de: {
		onDevice: 'Lautstärke: mit den Tasten an diesem Gerät',
		onOtherDevice: 'Die Lautstärke stellst du dort ein.',
	},
	en: {
		onDevice: 'Volume: use the buttons on this device',
		onOtherDevice: 'Set the volume on that device.',
	},
};

export function volumeHintText(language, key) {
	return (HINT_TEXT[language] || HINT_TEXT.en)[key];
}
