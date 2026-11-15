// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React from 'react';
import PropTypes from 'prop-types';
import { Language } from '../contexts/LanguageContext';

// Text-only "Developed with YouTube" tagline, used under the CueVote
// wordmark on the Lobby and beside fullscreen-page titles
// (PendingRequestsPage, BannedVideosPage). Required wherever YouTube
// thumbnails, titles, channel names, or video metadata are rendered
// (YouTube API Services Terms — Required Minimum Functionality and
// Attribution sections). "Developed with YouTube" is YouTube's own
// Branding-Guidelines phrase for apps that would be nonfunctional
// without YouTube — CueVote's exact case.
//
// No brandmark by design here — the localised string already names the
// service and a red icon under the orange CueVote wordmark felt visually
// heavy. Inside an active channel the attribution is handled by
// YouTubeBrandStamp (with brandmark) — that header has space to spare on
// the right edge, so the visual indicator fits naturally there.
export function YouTubeBrandSubtitle({ className = '' }) {
	const { t } = Language.useLanguage();
	return (
		<a
			href="https://www.youtube.com"
			target="_blank"
			rel="noopener noreferrer"
			className={`inline-block text-[11px] leading-4 text-ink-3 hover:text-ink-2 no-underline transition-colors duration-150 select-none ${className}`}
		>
			{t('attribution.youtube')}
		</a>
	);
}

YouTubeBrandSubtitle.propTypes = {
	className: PropTypes.string,
};
