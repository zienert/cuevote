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

const hourFormatters = new Map();

/**
 * Hours, written out as the reader's language says them: "2 hours",
 * "2 Stunden", "2 часа", "ساعتان". The plural form is the language's own.
 */
export function formatHours(value, language) {
	let formatter = hourFormatters.get(language);
	if (!formatter) {
		const options = { style: 'unit', unit: 'hour', unitDisplay: 'long', numberingSystem: 'latn' };
		try {
			formatter = new Intl.NumberFormat(language === 'sr' ? 'sr-Latn' : language, options);
		} catch {
			formatter = new Intl.NumberFormat('en', options);
		}
		hourFormatters.set(language, formatter);
	}
	return formatter.format(Number(value) || 0);
}
