// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// Single export object so bundler cannot reorder and cause "Cannot access 'ie' before initialization".
// All helpers are defined first, then one export at the end.

function isTV() {
	if (typeof navigator === 'undefined' || !navigator.userAgent) return false;
	if (typeof window !== 'undefined') {
		const params = new URLSearchParams(window.location.search);
		if (params.get('tv') === 'true') return true;
	}
	const userAgent = navigator.userAgent.toLowerCase();
	return (
		userAgent.includes('smart-tv') || userAgent.includes('smarttv') || userAgent.includes('googletv') ||
		userAgent.includes('appletv') || userAgent.includes('hbbtv') || userAgent.includes('pov_tv') ||
		userAgent.includes('netcast.tv') || userAgent.includes('webos') || userAgent.includes('tizen') ||
		userAgent.includes('android tv') || (userAgent.includes('android') && userAgent.includes('tv')) ||
		userAgent.includes('aft') || userAgent.includes('dtv') || userAgent.includes('bravia') ||
		userAgent.includes('viera') || userAgent.includes('philips') || userAgent.includes('crkey') ||
		userAgent.includes('roku') || userAgent.includes('large screen')
	);
}

function isTablet() {
	if (typeof navigator === 'undefined') return false;
	const userAgent = navigator.userAgent.toLowerCase();
	const isExplicitTablet = /ipad|tablet|playbook|silk/i.test(userAgent);
	const isAndroidTablet = /android/i.test(userAgent) && !/mobile/i.test(userAgent);
	const isIPadOS = (navigator.maxTouchPoints > 0) && /macintosh/i.test(userAgent);
	const isHybridTablet = (navigator.maxTouchPoints > 0) && (Math.min(window.innerWidth, window.innerHeight) >= 768);
	return isExplicitTablet || isAndroidTablet || isIPadOS || isHybridTablet;
}

function isIOS() {
	if (typeof navigator === 'undefined' || !navigator.userAgent) return false;
	const userAgent = navigator.userAgent.toLowerCase();
	return /iphone|ipad|ipod/i.test(userAgent) || (navigator.maxTouchPoints > 0 && /macintosh/i.test(userAgent));
}

function isNativeApp() {
	if (typeof navigator === 'undefined' || !navigator.userAgent) return false;
	return navigator.userAgent.toLowerCase().includes('cuevotewrapper');
}

// Raw Android phone/tablet (NOT Android TV — that is handled by isTV()).
function isAndroid() {
	if (typeof navigator === 'undefined' || !navigator.userAgent) return false;
	// Honor the ?tv=true dev override like isTV()/isMobile() do, so simulating a
	// TV consistently reports "not an Android phone" everywhere.
	if (typeof window !== 'undefined' &&
		new URLSearchParams(window.location.search).get('tv') === 'true') return false;
	const userAgent = navigator.userAgent.toLowerCase();
	return /android/i.test(userAgent) && !_isTV(userAgent);
}

// A phone/tablet WEB browser (iOS or Android), not the native wrapper, not a TV.
// These clients are forced into Venue Mode (vote/suggest only): in-browser video
// playback & prelisten are unreliable and ToS-sensitive, so the full player lives
// in the native app. iOS cannot sideload, so only Android sees the app-download
// footer — that gating lives at the call site via isAndroid().
function isMobileWebBrowser() {
	return (isIOS() || isAndroid()) && !isNativeApp();
}

function _isTV(userAgent) {
	return (
		userAgent.includes('smart-tv') || userAgent.includes('smarttv') || userAgent.includes('googletv') ||
		userAgent.includes('appletv') || userAgent.includes('hbbtv') || userAgent.includes('pov_tv') ||
		userAgent.includes('netcast.tv') || userAgent.includes('webos') || userAgent.includes('tizen') ||
		userAgent.includes('android tv') || (userAgent.includes('android') && userAgent.includes('tv')) ||
		userAgent.includes('aft') || userAgent.includes('dtv') || userAgent.includes('bravia') ||
		userAgent.includes('viera') || userAgent.includes('philips') || userAgent.includes('crkey') ||
		userAgent.includes('roku') || userAgent.includes('large screen')
	);
}

function isMobile() {
	if (typeof navigator === 'undefined' || !navigator.userAgent) return false;
	const userAgent = navigator.userAgent.toLowerCase();
	if (typeof window !== 'undefined') {
		const params = new URLSearchParams(window.location.search);
		if (params.get('tv') === 'true') return false;
	}
	if (_isTV(userAgent)) return false;
	return (
		/android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent) ||
		userAgent.includes('cuevotewrapper') ||
		(navigator.maxTouchPoints > 0 && window.innerWidth < 768)
	);
}

// Whether pages may not set a media element's volume here. An iPhone leaves
// loudness to its buttons: WebKit ignores HTMLMediaElement.volume there and
// says so with the :volume-locked pseudo-class. A browser that does not know
// the selector throws, and lets pages set the volume. Asked once.
let volumeLocked;
function isVolumeLocked() {
	if (volumeLocked === undefined) {
		try {
			volumeLocked = typeof document !== 'undefined' && document.createElement('audio').matches(':volume-locked');
		} catch {
			volumeLocked = false;
		}
	}
	return volumeLocked;
}

export const deviceDetection = { isTV, isTablet, isIOS, isNativeApp, isMobile, isAndroid, isMobileWebBrowser, isVolumeLocked };
