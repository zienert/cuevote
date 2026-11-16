// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert

const formatters = new Map();

/**
 * A count as the reader's language writes it: 1,284 in English, 1.284 in
 * German. Digits stay Latin in every language, as everywhere else in the app.
 */
export function formatCount(value, language) {
	const number = Number(value) || 0;
	let formatter = formatters.get(language);
	if (!formatter) {
		try {
			// Serbian is written in Latin script here.
			formatter = new Intl.NumberFormat(language === 'sr' ? 'sr-Latn' : language, { numberingSystem: 'latn' });
		} catch {
			formatter = new Intl.NumberFormat('en');
		}
		formatters.set(language, formatter);
	}
	return formatter.format(number);
}
