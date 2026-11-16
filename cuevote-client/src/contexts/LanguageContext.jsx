// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useState, useContext, useEffect, useRef, useCallback } from 'react';
import { LanguageContext } from './LanguageContextValue.js';
import { LANGUAGE_CODES, loadLanguage } from './translations';
import { SpinnerScreen } from '../components/Spinner';

const pluralRulesCache = new Map();
function getPluralRules(lang) {
	let rules = pluralRulesCache.get(lang);
	if (!rules) {
		rules = new Intl.PluralRules(lang);
		pluralRulesCache.set(lang, rules);
	}
	return rules;
}

function resolveKeyPath(root, keys) {
	let v = root;
	for (const k of keys) {
		if (v != null && typeof v === 'object' && v[k] !== undefined) v = v[k];
		else return undefined;
	}
	return v;
}

function selectPluralString(bag, lang, count) {
	if (bag == null || typeof bag !== 'object') return null;
	const category = getPluralRules(lang).select(count);
	if (typeof bag[category] === 'string') return bag[category];
	if (typeof bag.other === 'string') return bag.other;
	if (typeof bag.one === 'string') return bag.one;
	for (const v of Object.values(bag)) if (typeof v === 'string') return v;
	return null;
}

const AVAILABLE = new Set(LANGUAGE_CODES);

// localStorage throws, it does not return null, when site data is blocked or
// the page sits in a storage-partitioned frame. This module is imported
// eagerly by main.jsx BEFORE createRoot, so an unguarded read there takes the
// whole page down with a blank screen the ErrorBoundary never sees.
function readStored(key) {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStored(key, value) {
	try {
		localStorage.setItem(key, value);
	} catch { /* nothing to do; the choice just will not persist */ }
}

// Detection only needs the list of codes, not the strings, so it settles
// synchronously — which is what lets the right chunk start downloading in the
// same tick the app boots instead of after a round trip.
function detectInitialLanguage() {
	const saved = readStored('cuevote_language');
	if (saved && AVAILABLE.has(saved)) return saved;
	const browserLang = (typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage)) || '';
	if (browserLang) {
		if (browserLang.toLowerCase() === 'zh-cn' || browserLang.toLowerCase() === 'zh-sg') {
			if (AVAILABLE.has('zh-CN')) return 'zh-CN';
		}
		if (browserLang.toLowerCase() === 'zh-tw' || browserLang.toLowerCase() === 'zh-hk') {
			if (AVAILABLE.has('zh-TW')) return 'zh-TW';
		}
		const code = browserLang.split('-')[0];
		if (AVAILABLE.has(code)) return code;
	}
	return 'en';
}

const INITIAL_LANGUAGE = detectInitialLanguage();

// Start both downloads the moment this (eagerly-loaded) contexts chunk
// evaluates, so they overlap the app code instead of waiting for an effect —
// this is what closes the window where raw i18n keys could flash. English comes
// along as the fallback for any key the chosen language is missing; when that
// IS the chosen language it is a single request.
// Never rejects: a rejected module-scope promise with a single `.then` consumer
// leaves the app on the splash forever and logs nothing. English is the one
// that must land (every fallback goes through it), so it is the one that is
// retried, and its failure is reported rather than swallowed.
const initialBundles = Promise.all([
	loadLanguage('en').catch(() => loadLanguage('en')).catch(() => null),
	INITIAL_LANGUAGE === 'en' ? null : loadLanguage(INITIAL_LANGUAGE).catch(() => null),
]).then(([en, target]) => {
	const bundles = {};
	if (en) bundles.en = en;
	if (target) bundles[INITIAL_LANGUAGE] = target;
	return bundles;
});

// Single export with inline methods so bundler cannot reorder and cause TDZ.
export const Language = {
	LanguageProvider({ children }) {
		// The language the visitor picked, and the one the UI is showing. They
		// differ only while a newly picked language is still downloading: the UI
		// keeps the old strings until the new ones are in hand. Gating the whole
		// tree on the picked language instead unmounted everything below this
		// provider for the length of the download, router and WebSocket included,
		// so every first switch blanked the screen and reconnected the socket.
		const [selected, setSelected] = useState(INITIAL_LANGUAGE);
		const [shown, setShown] = useState(INITIAL_LANGUAGE);
		// Keyed by language code; holds every language loaded so far.
		const [translations, setTranslations] = useState(null);
		// Languages whose chunk did not load. Tracked so the gate below can stop
		// waiting for one that is never coming, instead of holding the splash.
		const [failed, setFailed] = useState(() => new Set());
		const initDone = useRef(false);
		useEffect(() => {
			if (initDone.current) return;
			initDone.current = true;
			initialBundles.then((bundles) => {
				setTranslations(bundles);
				if (!bundles[INITIAL_LANGUAGE]) {
					setFailed((prev) => new Set(prev).add(INITIAL_LANGUAGE));
				}
			});
		}, []);
		// Switching language pulls in that chunk once and keeps it. The switch
		// shows once the strings are in hand, or, if the chunk failed, with
		// English standing in for them.
		useEffect(() => {
			if (!translations) return;
			if (translations[selected] || failed.has(selected)) {
				setShown(selected);
				return;
			}
			let cancelled = false;
			loadLanguage(selected).then(
				(bag) => {
					if (cancelled) return;
					setTranslations((prev) => ({ ...prev, [selected]: bag }));
				},
				() => {
					if (cancelled) return;
					setFailed((prev) => new Set(prev).add(selected));
				},
			);
			return () => { cancelled = true; };
		}, [selected, translations, failed]);
		useEffect(() => {
			writeStored('cuevote_language', selected);
		}, [selected]);
		// Picking a language whose chunk failed earlier reloads the page. A second
		// import() in the same page cannot retry: the browser keeps the failed
		// module for the page's lifetime and hands back the same error without
		// another request. The choice is stored first, so the reload loads it.
		const selectLanguage = useCallback((code) => {
			if (failed.has(code)) {
				writeStored('cuevote_language', code);
				window.location.reload();
				return;
			}
			setSelected(code);
		}, [failed]);
		// Ready once the first load settled: the shown language is in hand, or
		// English stands in for it. Only that first load can hold the splash,
		// because `shown` moves to a new language only after its strings arrived
		// (or it failed and English took over).
		const hasAny = !!translations && Object.keys(translations).length > 0;
		const ready = hasAny && (!!translations[shown] || !!translations.en);
		// Nothing loaded at all: English itself failed after a retry. An eternal
		// spinner is the wrong answer — offer the one action that can recover.
		const fatal = !!translations && !hasAny;

		const t = (key, params = {}) => {
			if (!translations) return key;
			const keys = key.split('.');
			let value = resolveKeyPath(translations[shown], keys);
			let usedLang = shown;
			if (value === undefined) {
				value = resolveKeyPath(translations.en, keys);
				usedLang = 'en';
				if (value === undefined) return key;
			}
			// Plural-bag handling: object value + numeric count param.
			if (value !== null && typeof value === 'object' && params.count !== undefined) {
				let str = selectPluralString(value, usedLang, params.count);
				if (str == null && usedLang !== 'en') {
					const enBag = resolveKeyPath(translations.en, keys);
					str = selectPluralString(enBag, 'en', params.count);
				}
				if (str == null) return key;
				value = str;
			}
			if (typeof value === 'string') {
				return value.replace(/\{(\w+)\}/g, (match, param) => {
					return params[param] !== undefined ? params[param] : match;
				});
			}
			return value;
		};
		return (
			<LanguageContext.Provider value={{ language: shown, setLanguage: selectLanguage, t }}>
				{ready ? children : fatal ? (
					// No strings at all, so nothing here can be translated. A reload
					// glyph and an English aria-label are the honest minimum, and
					// better than a spinner that will never stop.
					<div className="fixed inset-0 z-[100] bg-[#050505] flex items-center justify-center">
						<button
							onClick={() => window.location.reload()}
							className="flex items-center justify-center w-14 h-14 rounded-full border-2 border-neutral-800 text-orange-500 hover:border-orange-500 transition-colors"
							aria-label="Reload"
							title="Reload"
						>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-7 h-7" aria-hidden="true">
								<path d="M21 12a9 9 0 1 1-2.64-6.36" />
								<polyline points="21 3 21 9 15 9" />
							</svg>
						</button>
					</div>
				) : (
					// Language-neutral splash until translations resolve, so raw i18n
					// keys never paint. Intentionally text-free — any copy here would
					// itself be untranslated. Matches the app's dark + orange theme.
					<SpinnerScreen />
				)}
			</LanguageContext.Provider>
		);
	},
	useLanguage() {
		const context = useContext(LanguageContext);
		if (context === undefined) {
			throw new Error('useLanguage must be used within a LanguageProvider');
		}
		return context;
	},
};
