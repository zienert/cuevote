// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import PropTypes from 'prop-types';
import { Language } from '../contexts/LanguageContext';

// What kind of message it is shows in the icon's shape and tone; the surface
// stays the same quiet one.
const KINDS = {
	info: { Icon: Info, tone: 'text-ink-2' },
	success: { Icon: CheckCircle, tone: 'text-accent' },
	error: { Icon: AlertCircle, tone: 'text-red-400' },
};

export function Toast({ message, type = 'info', onClose, duration = 3000 }) {
	const { t } = Language.useLanguage();

	useEffect(() => {
		const timer = setTimeout(onClose, duration);
		return () => clearTimeout(timer);
	}, [duration, onClose]);

	const { Icon, tone } = KINDS[type] || KINDS.info;

	return (
		// Below the room's header, which is taller on phones (tabs under the bar).
		<div
			role={type === 'error' ? 'alert' : 'status'}
			className="fixed right-4 top-24 z-[100] flex max-w-sm items-center gap-3 rounded-xl border border-line bg-raised px-4 py-3 text-ink shadow-lg shadow-black/40 animate-in fade-in slide-in-from-right-5 duration-300 max-md:left-4 max-md:top-36"
		>
			<Icon size={20} className={`flex-shrink-0 ${tone}`} aria-hidden="true" />
			<span className="min-w-0 flex-1 break-words text-sm font-medium">{message}</span>
			<button
				onClick={onClose}
				aria-label={t('header.close')}
				className="cv-hit -mr-1 flex h-8 w-8 flex-none items-center justify-center rounded-lg text-ink-2 transition-colors duration-150 hover:bg-page hover:text-ink"
			>
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
