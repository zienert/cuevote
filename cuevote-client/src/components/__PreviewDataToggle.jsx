// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
// DEV-ONLY: the switch between the datasets of a stress test, for the two
// previews (see __previewData.js).
import React from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { DATA, SHOW_SWITCH, STATES } from './__previewData';

const LABELS = { demo: 'Demo', worst: 'Worst case', empty: 'Empty', one: 'One' };

/**
 * The switch between the datasets: plain chrome, not part of the design under
 * test. Shows only with ?data in the address; a choice reloads the page with
 * it, so the address carries the state.
 */
export function DataToggle({ many }) {
	if (!SHOW_SWITCH) return null;
	const pick = (value) => {
		const url = new URL(window.location.href);
		url.searchParams.set('data', value);
		window.location.assign(url);
	};
	return createPortal(
		<div
			role="group"
			aria-label="Preview data"
			style={{
				position: 'fixed', left: '50%', bottom: 'calc(var(--bottom-bar-h, 0px) + 12px)', transform: 'translateX(-50%)',
				zIndex: 2147483000, display: 'flex', gap: 2, padding: 3, borderRadius: 999, background: '#d4d4d8',
				font: '500 12px/1 system-ui, sans-serif', boxShadow: '0 1px 4px rgba(0, 0, 0, 0.35)', whiteSpace: 'nowrap',
			}}
		>
			{STATES.map((value) => (
				<button
					key={value}
					type="button"
					aria-pressed={DATA === value}
					onClick={() => pick(value)}
					style={{
						padding: '7px 8px', borderRadius: 999, border: 0, font: 'inherit', cursor: 'pointer', color: '#18181b',
						background: DATA === value ? '#fff' : 'transparent',
					}}
				>
					{LABELS[value] || many}
				</button>
			))}
		</div>,
		document.body,
	);
}

DataToggle.propTypes = {
	// The label of the upper bound, e.g. "300 rows".
	many: PropTypes.string.isRequired,
};
