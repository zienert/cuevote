// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React from "react";
import { Cookie } from "lucide-react";
import { Language } from "../contexts/LanguageContext";
import { useLocation } from "react-router-dom";

// In a room only when asked for by a sign-in button (`forSignIn`): an Apple
// channel has no welcome screen that asks for it.
export function CookieConsent({ onAccept, forSignIn = false }) {
	const { t } = Language.useLanguage();
	const location = useLocation();

	if (location.pathname.startsWith("/room/") && !forSignIn) return null;

	// The words are the consent text and stay as they are; the card, the icon
	// and the button follow the design of the lobby and the room.
	return (
		<div className="fixed bottom-0 left-0 right-0 z-[100] animate-in slide-in-from-bottom-4 fade-in duration-300 md:bottom-4 md:left-auto md:right-6 md:w-[400px]">
			<div className="rounded-t-2xl border border-line bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] shadow-2xl shadow-black/50 md:rounded-2xl md:p-5">
				<div className="flex items-start gap-3">
					<Cookie size={22} strokeWidth={1.75} className="mt-0.5 flex-none text-accent" aria-hidden="true" />
					<div className="min-w-0 flex-1 space-y-3">
						<div>
							<h3 className="text-base font-semibold text-ink">{t('cookie.title')}</h3>
							<p className="mt-1 text-sm leading-relaxed text-ink-2">
								{/* Asked for to sign in: no YouTube player is involved. */}
								{t(forSignIn ? 'cookie.signInDescription' : 'cookie.description')}
								<br />
								<a href="/legal" target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2 transition-colors duration-150 hover:text-[#fb8b3c]">{t('cookie.policy')}</a>.
							</p>
						</div>
						<button
							onClick={onAccept}
							className="cv-btn cv-btn-accent h-11 w-full font-semibold"
						>
							{t(forSignIn ? 'cookie.signInAccept' : 'cookie.accept')}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
