// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React from 'react';
import { Download } from 'lucide-react';
import { deviceDetection } from '../utils/deviceDetection';
import { Language } from '../contexts/LanguageContext';

// Shown only to devices that genuinely cannot run the web player — currently
// TVs (leanback), which need the native CueVote TV app. Phones are NOT blocked:
// iOS/Android browsers run the web app in Venue Mode, and Android is offered the
// app via AppPromoFooter. (?forceBlock=1 in DEV also lands here for preview.)
export const MobileBlockPage = () => {
	const isTvDevice = deviceDetection.isTV();
	const { t } = Language.useLanguage();

	const apkUrl = "https://github.com/zienert/cuevote/releases/latest/download/app-release.apk";

	return (
		<div className="flex flex-col min-h-[100dvh] bg-[#050505] items-center justify-center p-[clamp(0.9rem,4.5vw,1.5rem)] text-center relative overflow-hidden select-none font-sans">
			{/* Dynamic Background */}
			<div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-orange-900/40 via-[#050505] to-[#050505] animate-pulse-slow pointer-events-none" />

			<div className="relative z-10 w-full max-w-md space-y-[clamp(1.1rem,4.5vw,1.75rem)] animate-in fade-in zoom-in-95 duration-700 flex flex-col items-center py-[clamp(1.25rem,5vw,2rem)]">

				{/* Header */}
				<div className="space-y-[clamp(0.4rem,2vw,0.75rem)] flex flex-col items-center">
					<h1 className="text-[clamp(1.75rem,9vw,2.75rem)] font-black tracking-tighter text-white leading-none drop-shadow-2xl">CueVote</h1>
					<div className="h-[3px] w-[clamp(3.5rem,16vw,6rem)] bg-gradient-to-r from-orange-600 to-orange-400 rounded-full" />
					<p className="text-[clamp(0.72rem,3.1vw,0.95rem)] font-bold tracking-widest uppercase text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-orange-400">
						{t('mobile.tagline')}
					</p>
					<p className="text-[clamp(0.82rem,3.4vw,1rem)] text-neutral-300 font-medium leading-relaxed max-w-xs mx-auto opacity-90">
						{isTvDevice ? t('mobile.tvDescription') : t('mobile.mobileDescription')}
					</p>
				</div>

				{/* Download */}
				<div className="w-full space-y-[clamp(0.6rem,2.6vw,0.85rem)]">
					<a
						href={apkUrl}
						download="CueVote-App.apk"
						target="_blank"
						rel="noopener noreferrer"
						className="relative w-full py-[clamp(0.75rem,3.4vw,1rem)] px-[clamp(2.6rem,12vw,3.25rem)] rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 text-white font-bold text-[clamp(0.95rem,3.9vw,1.125rem)] shadow-xl hover:shadow-orange-500/30 hover:scale-[1.02] active:scale-95 transition-all duration-200 flex items-center justify-center text-center leading-tight"
					>
						<Download className="absolute left-[clamp(0.85rem,4.5vw,1.25rem)] top-1/2 -translate-y-1/2 w-[clamp(1.05rem,4.6vw,1.4rem)] h-[clamp(1.05rem,4.6vw,1.4rem)] fill-current" />
						<span>{isTvDevice ? t('mobile.downloadTv') : t('mobile.downloadMobile')}</span>
					</a>
					<p className="text-[clamp(0.62rem,2.7vw,0.75rem)] text-neutral-500 leading-snug">
						{t('mobile.requirement')} · <span className="opacity-70">{t('mobile.downloadFail')}</span> {t('mobile.installInstruction')}
					</p>
				</div>

				<a href="/legal" className="text-[clamp(0.62rem,2.7vw,0.75rem)] text-neutral-500 hover:text-orange-400 underline underline-offset-4 transition-colors">
					{t('mobile.privacyLegal')}
				</a>
			</div>
		</div>
	);
};
