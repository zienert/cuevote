// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useContext, useState, useEffect } from 'react';
import { ConsentContext } from './ConsentContextValue.js';

// Single export with inline functions so bundler cannot reorder and cause TDZ.
export const Consent = {
	ConsentProvider({ children }) {
		const [hasConsent, setHasConsent] = useState(() => {
			return localStorage.getItem("cuevote_cookie_consent") === "true";
		});
		const [showBanner, setShowBanner] = useState(false);
		useEffect(() => {
			if (!hasConsent) {
				const timer = setTimeout(() => setShowBanner(true), 1000);
				return () => clearTimeout(timer);
			}
		}, [hasConsent]);
		const giveConsent = () => {
			localStorage.setItem("cuevote_cookie_consent", "true");
			setHasConsent(true);
			setShowBanner(false);
		};
		const askForConsent = () => setShowBanner(true);
		// Apple Music channels load cover art and, for the host, MusicKit from
		// Apple. Their own consent: agreeing to YouTube and Google says nothing
		// about Apple, and agreeing in an Apple channel nothing about YouTube.
		const [hasAppleConsent, setHasAppleConsent] = useState(() => {
			return localStorage.getItem("cuevote_apple_consent") === "true";
		});
		const giveAppleConsent = () => {
			localStorage.setItem("cuevote_apple_consent", "true");
			setHasAppleConsent(true);
		};
		return (
			<ConsentContext.Provider value={{ hasConsent, showBanner, giveConsent, askForConsent, setShowBanner, hasAppleConsent, giveAppleConsent }}>
				{children}
			</ConsentContext.Provider>
		);
	},
	useConsent() {
		return useContext(ConsentContext);
	},
};
