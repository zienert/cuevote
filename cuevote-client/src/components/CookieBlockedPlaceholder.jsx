// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React from 'react';
import { Cookie } from 'lucide-react';
import { Language } from '../contexts/LanguageContext';
import { Consent } from '../contexts/ConsentContext';

export function CookieBlockedPlaceholder() {
	const { t } = Language.useLanguage();
	const { giveConsent } = Consent.useConsent();

	return (
		<div className="w-full h-full flex items-center justify-center bg-black relative overflow-hidden">
			{/* Background Gradient similar to CookieConsent */}
			<div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 to-purple-500/5 pointer-events-none" />

			<div className="bg-[#111] border border-white/10 p-8 rounded-2xl shadow-2xl shadow-black/50 backdrop-blur-xl relative max-w-md w-full mx-4 text-center">
				<div className="flex flex-col items-center gap-4">
					<div className="p-4 rounded-full bg-orange-500/10 text-orange-500">
						<Cookie size={32} />
					</div>

					<div className="space-y-3">
						<h3 className="text-white font-bold text-xl">{t('cookie.title')}</h3>
						<div className="text-neutral-400 text-sm leading-relaxed max-w-xs mx-auto">
							<p>{t('cookie.description')}</p>
							<p className="mt-2 text-xs text-neutral-500">
								{t('cookie.youtubeConsent')}
								<br />
								<a href="/legal" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-400 underline underline-offset-2 mt-1 inline-block">
									{t('cookie.policy')}
								</a>
							</p>
						</div>

						<button
							onClick={giveConsent}
							className="mt-4 px-8 py-3 rounded-xl bg-white text-black font-bold text-sm hover:bg-neutral-200 transition-colors shadow-lg active:scale-95 transform duration-100 flex items-center gap-2 mx-auto"
						>
							<Cookie size={18} className="text-orange-600" />
							{t('cookie.accept')}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
