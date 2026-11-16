// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
//
// One chunk per language, loaded on demand.
//
// All 35 languages used to live in a single module. That module was already
// dynamically imported, but it still meant a visitor downloaded every language
// to read one of them — more bytes than React, the router and the OAuth client
// together, on the critical path before anything could render. A guest joining
// a party over venue wifi paid for 34 languages they cannot read.
//
// Each locale is its own module here, so the bundler emits one chunk per
// language and a visitor fetches their own plus English (the fallback for any
// key a translation is missing).
//
// These stay dynamic imports: evaluating a locale during entry init is what
// caused the "Cannot access before initialization" TDZ crash fixed in 1b57d50.

const loaders = import.meta.glob('./locales/*.js');

function codeFromPath(path) {
	return path.slice('./locales/'.length, -'.js'.length);
}

/** Every language that has a locale file, derived from the files themselves. */
export const LANGUAGE_CODES = Object.keys(loaders).map(codeFromPath).sort();

const cache = new Map();

/**
 * The strings for one language. Repeated calls share one request, and one
 * parsed object — switching back and forth costs nothing after the first load.
 * Rejects for a code with no locale file; callers should check LANGUAGE_CODES.
 *
 * A FAILED load is evicted rather than remembered, so a later call asks again.
 * Within one page that is not a real retry, though: the browser keeps a failed
 * module import and answers the same URL with the same error, without another
 * request. LanguageContext therefore reloads the page when a failed language is
 * picked again.
 */
export function loadLanguage(code) {
	const cached = cache.get(code);
	if (cached) return cached;

	const load = loaders[`./locales/${code}.js`];
	if (!load) return Promise.reject(new Error(`No translations for language "${code}"`));

	const promise = load().then(
		(m) => {
			if (!m || typeof m.default !== 'object' || m.default === null) {
				cache.delete(code);
				throw new Error(`Locale "${code}" has no default export`);
			}
			return m.default;
		},
		(err) => {
			cache.delete(code); // let the next attempt actually try again
			throw err;
		},
	);
	cache.set(code, promise);
	return promise;
}
