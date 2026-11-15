// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React from 'react';
import PropTypes from 'prop-types';

/**
 * One choice out of a few, drawn as a single control with a sliding marker:
 * the create dialog's music source and privacy, and the views of a room on a
 * phone (`size="sm"` where three have to fit).
 *
 * Plain toggle buttons rather than a radio group: a radio group takes the
 * arrow keys for itself, and a TV remote needs them to move on to the next
 * field of the dialog.
 */
export function SegmentedControl({ labelledBy, options, value, onChange, size = 'md' }) {
	const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));

	return (
		<div
			role="group"
			aria-labelledby={labelledBy}
			className="relative grid grid-flow-col auto-cols-fr rounded-xl border border-neutral-800 bg-[#050505] p-1"
		>
			<span
				aria-hidden="true"
				className="pointer-events-none absolute inset-y-1 left-1 rounded-lg bg-gradient-to-b from-orange-500 to-orange-600 shadow-[0_6px_18px_-6px_rgba(249,115,22,0.7)] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
				style={{
					width: `calc((100% - 0.5rem) / ${options.length})`,
					transform: `translateX(${selectedIndex * 100}%)`,
				}}
			/>
			{options.map((option) => {
				const selected = option.value === value;
				const Icon = option.icon;
				return (
					<button
						key={option.value}
						type="button"
						aria-pressed={selected}
						onClick={() => onChange(option.value)}
						className={`relative flex min-w-0 items-center justify-center gap-2 rounded-lg font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:text-white ${size === 'sm' ? 'px-1.5 py-2 text-[13px] tracking-tight' : 'px-3 py-2.5 text-sm'} ${selected ? 'text-white' : 'text-neutral-400 hover:text-neutral-200'}`}
					>
						{Icon ? <Icon size={16} className="shrink-0" /> : null}
						<span className="truncate">{option.label}</span>
					</button>
				);
			})}
		</div>
	);
}

SegmentedControl.propTypes = {
	labelledBy: PropTypes.string.isRequired,
	options: PropTypes.arrayOf(PropTypes.shape({
		value: PropTypes.string.isRequired,
		label: PropTypes.string.isRequired,
		icon: PropTypes.elementType,
	})).isRequired,
	value: PropTypes.string.isRequired,
	onChange: PropTypes.func.isRequired,
	size: PropTypes.oneOf(['md', 'sm']),
};
