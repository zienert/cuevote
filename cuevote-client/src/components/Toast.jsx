// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import PropTypes from 'prop-types';

export function Toast({ message, type = 'info', onClose, duration = 3000 }) {
	useEffect(() => {
		const timer = setTimeout(onClose, duration);
		return () => clearTimeout(timer);
	}, [duration, onClose]);

	let bgClass = 'bg-neutral-800/90 border-neutral-700'; // Default info
	let Icon = Info;

	if (type === 'error') {
		bgClass = 'bg-red-900/90 border-red-800 text-red-100';
		Icon = AlertCircle;
	} else if (type === 'success') {
		bgClass = 'bg-green-900/90 border-green-800 text-green-100';
		Icon = CheckCircle;
	}

	return (
		// Below the room's header, which is taller on phones (tabs under the bar).
		<div className={`fixed top-24 max-md:top-36 right-4 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl backdrop-blur-md border ${bgClass} animate-in fade-in slide-in-from-right-5 duration-300 max-w-sm`}>
			<Icon size={20} className="flex-shrink-0" />
			<span className="text-sm font-medium">{message}</span>
			<button onClick={onClose} className="ml-2 hover:opacity-70 transition-opacity">
				<X size={16} />
			</button>
		</div>
	);
}

Toast.propTypes = {
	message: PropTypes.string.isRequired,
	type: PropTypes.oneOf(['info', 'success', 'error']),
	onClose: PropTypes.func.isRequired,
	duration: PropTypes.number
};
