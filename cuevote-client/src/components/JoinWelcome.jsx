// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React from 'react';
import { Music, PlayCircle } from 'lucide-react';
import { Language } from '../contexts/LanguageContext';
import { Spinner } from './Spinner';

// The first screen of a YouTube channel for someone who has not agreed yet:
// what the channel loads from YouTube and the button to agree and join.
// `provider` is null while the channel is checked; an Apple Music channel then
// opens without this screen.
export function JoinWelcome({ provider, onAccept }) {
	const { t } = Language.useLanguage();
	const [welcomeBefore, welcomeAfter = ''] = t('join.welcome').split('{brand}');
	const [agreeBefore, agreeAfter = ''] = t('join.agree').split('{policy}');

	return (
		<div className="flex h-[100dvh] select-none flex-col items-center justify-center bg-page p-6 text-ink">
			<div className="w-full max-w-md space-y-8 text-center animate-in fade-in duration-200">
				<div className="space-y-2">
					<h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">
						{welcomeBefore}<span className="text-accent">CueVote</span>{welcomeAfter}
					</h1>
					<p className="text-lg text-ink-2">{t('mobile.tagline')}</p>
				</div>
				{/* The one lit card of the screen, like the tile that creates a
				    channel in the lobby: an orange outline, the icon as a line. */}
				<div className="space-y-6 rounded-2xl border border-accent bg-card p-6 ring-2 ring-accent/50 sm:p-8">
					<Music className="mx-auto h-8 w-8 text-accent" strokeWidth={1.75} aria-hidden="true" />
					{provider ? (
						<div className="space-y-2">
							<h2 className="text-xl font-semibold">{t('join.youtubeTitle')}</h2>
							<p className="text-[15px] leading-relaxed text-ink-2">{t('join.youtubeBody')}</p>
						</div>
					) : (
						<p className="flex items-center justify-center gap-2 text-sm text-ink-2" role="status">
							<Spinner className="h-4 w-4" />
							{t('join.checking')}
						</p>
					)}
					<button
						onClick={onAccept}
						disabled={!provider}
						className="cv-btn cv-btn-accent h-12 w-full text-base font-semibold shadow-[0_6px_18px_-6px_rgb(249_115_22/0.7)] disabled:shadow-none"
					>
						<PlayCircle size={20} aria-hidden="true" />
						{t('join.accept')}
					</button>
					<p className="text-xs leading-relaxed text-ink-3">
						{agreeBefore}<a href="/legal" target="_blank" rel="noopener noreferrer" className="text-ink-2 underline underline-offset-2 hover:text-ink">{t('join.policy')}</a>{agreeAfter}
					</p>
				</div>
			</div>
		</div>
	);
}
