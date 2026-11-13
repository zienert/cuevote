// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React from 'react';
import { Loader2, Music, PlayCircle } from 'lucide-react';
import { Language } from '../contexts/LanguageContext';

// The first screen of a YouTube channel for someone who has not agreed yet:
// what the channel loads from YouTube and the button to agree and join.
// `provider` is null while the channel is checked; an Apple Music channel then
// opens without this screen.
export function JoinWelcome({ provider, onAccept }) {
	const { t } = Language.useLanguage();
	const [welcomeBefore, welcomeAfter = ''] = t('join.welcome').split('{brand}');
	const [agreeBefore, agreeAfter = ''] = t('join.agree').split('{policy}');

	return (
		<div className="flex flex-col h-[100dvh] bg-[#050505] items-center justify-center p-6 relative overflow-hidden select-none">
			<div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-orange-900/20 via-[#050505] to-[#050505] pointer-events-none" />
			<div className="relative z-10 max-w-lg text-center space-y-8 animate-in fade-in zoom-in-95 duration-500">
				<div className="space-y-2">
					<h1 className="text-4xl md:text-6xl font-bold tracking-tighter text-white">
						{welcomeBefore}<span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-orange-400">CueVote</span>{welcomeAfter}
					</h1>
					<p className="text-xl text-neutral-400 font-medium">{t('mobile.tagline')}</p>
				</div>
				<div className="p-8 rounded-3xl bg-neutral-900/50 border border-white/5 backdrop-blur-xl shadow-2xl space-y-6">
					<div className="mx-auto w-16 h-16 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-500 mb-4">
						<Music size={32} />
					</div>
					{provider ? (
						<div className="space-y-2">
							<h2 className="text-2xl font-bold text-white">{t('join.youtubeTitle')}</h2>
							<p className="text-neutral-400 text-sm leading-relaxed">{t('join.youtubeBody')}</p>
						</div>
					) : (
						<p className="flex items-center justify-center gap-2 text-neutral-400 text-sm" role="status">
							<Loader2 size={16} className="animate-spin" />
							{t('join.checking')}
						</p>
					)}
					<button
						onClick={onAccept}
						disabled={!provider}
						className="w-full py-4 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white font-bold text-lg shadow-lg hover:shadow-orange-500/20 hover:scale-[1.02] active:scale-95 transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
					>
						<PlayCircle size={24} className="fill-current" />
						{t('join.accept')}
					</button>
					<p className="text-xs text-neutral-600">
						{agreeBefore}<a href="/legal" target="_blank" rel="noopener noreferrer" className="underline hover:text-neutral-400">{t('join.policy')}</a>{agreeAfter}
					</p>
				</div>
			</div>
		</div>
	);
}
