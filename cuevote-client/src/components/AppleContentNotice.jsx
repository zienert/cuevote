// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React from 'react';
import PropTypes from 'prop-types';
import { Language } from '../contexts/LanguageContext';

/**
 * A guest's switch for what an Apple Music channel loads from Apple: cover art
 * and previews. Until it is pressed the channel loads nothing from Apple.
 * `layout`: "bar" above the playlist, "card" inside the preview window.
 */
export function AppleContentNotice({ onAccept, layout = 'bar' }) {
	const { t } = Language.useLanguage();
	const isCard = layout === 'card';

	return (
		<div className={isCard
			? 'mx-auto max-w-sm space-y-4 p-6 text-center'
			: 'flex-none border-b border-neutral-800 bg-neutral-900/80 px-4 py-2'}
		>
			<div className={isCard ? 'space-y-4' : 'max-w-3xl mx-auto flex items-center gap-3'}>
				<p className={`${isCard ? 'text-sm text-neutral-300' : 'flex-1 text-xs text-neutral-400'} leading-snug`}>
					{t('appleMusic.contentNotice')}{' '}
					<a href="/legal?tab=privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-neutral-200">
						{t('join.policy')}
					</a>
				</p>
				<button
					type="button"
					onClick={onAccept}
					className="shrink-0 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-black hover:bg-neutral-200 transition-colors"
				>
					{t('appleMusic.contentAccept')}
				</button>
			</div>
		</div>
	);
}

AppleContentNotice.propTypes = {
	onAccept: PropTypes.func.isRequired,
	layout: PropTypes.oneOf(['bar', 'card']),
};
