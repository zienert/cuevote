// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { useLocation } from 'react-router-dom';
import { Consent } from '../contexts/ConsentContext';
import { CookieConsent } from './CookieConsent';

export function ConditionalGoogleOAuthProvider({ children }) {
	const { hasConsent, showBanner, giveConsent, consentRequested } = Consent.useConsent();
	const location = useLocation();

	// Check if we are inside a room (URLs starting with /room/)
	const isInRoom = location.pathname.startsWith('/room/');

	const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

	return (
		<>
			{hasConsent && clientId ? (
				<GoogleOAuthProvider clientId={clientId}>
					{children}
				</GoogleOAuthProvider>
			) : (
				<>
					{children}
				</>
			)}
			{/* Not in a room on its own, but when asked for there: an Apple
			    channel has no welcome screen, and signing in with Google needs
			    this consent (the button did nothing, 14.11.2026). */}
			{showBanner && (!isInRoom || consentRequested) && <CookieConsent onAccept={giveConsent} forSignIn={consentRequested} />}
		</>
	);
}
