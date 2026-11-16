// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Maximize2 } from 'lucide-react';
import { Player } from './Player';
import PlayerErrorBoundary from './PlayerErrorBoundary';

export function PrelistenOverlay({ hasConsent, playbackError, playerContainerRef, t, isCinemaMode }) {
	const containerRef = useRef(null);
	const [isTooSmall, setIsTooSmall] = useState(false);
	const [CookieBlockedPlaceholderComponent, setCookieBlockedPlaceholder] = useState(null);
	useEffect(() => {
		import('./CookieBlockedPlaceholder').then((m) => setCookieBlockedPlaceholder(() => m.CookieBlockedPlaceholder));
	}, []);
	useEffect(() => {
		if (!containerRef.current) return;

		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const { width, height } = entry.contentRect;
				// Check if smaller than 200x200
				const tooSmall = width < 200 || height < 200;
				setIsTooSmall(tooSmall);
			}
		});

		resizeObserver.observe(containerRef.current);

		return () => {
			resizeObserver.disconnect();
		};
	}, []);

	// Optimize padding for Mobile Landscape (CinemaMode) where Header is hidden
	const paddingTop = isCinemaMode ? 'pt-4' : 'pt-20';
	// Back to Radio bar is smaller in landscape/mobile usually, but let's be safe. 
	// pb-24 (96px) is safe for standard, pb-20 (80px) for tight landscape.
	const paddingBottom = isCinemaMode ? 'pb-20' : 'pb-24';

	return (
		<div className={`fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center ${paddingTop} ${paddingBottom} px-4 animate-fadeIn`}>
			<div
				ref={containerRef}
				className="relative aspect-video max-h-full w-full max-w-5xl overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-line"
			>
				{isTooSmall ? (
					<div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black p-4 text-center animate-fadeIn">
						<Maximize2 size={20} className="mb-3 text-accent" aria-hidden="true" />
						<h2 className="mb-1 text-sm font-semibold text-ink">{t('app.windowTooSmall')}</h2>
						<p className="text-xs text-ink-2">{t('app.windowTooSmallMessage')}</p>
					</div>
				) : (
					<PlayerErrorBoundary>
						{hasConsent ? (
							playbackError ? (
								<div className="flex h-full w-full flex-col items-center justify-center space-y-3 bg-card p-6 text-center">
									<AlertTriangle size={24} className="text-ink-2" aria-hidden="true" />
									<div>
										<p className="mb-1 font-medium text-ink">
											{playbackError === 100 ? t('player.errorNotFound') : (playbackError === 101 || playbackError === 150 ? t('player.errorRestricted') : t('player.errorGeneric'))}
										</p>
									</div>
								</div>
							) : (
								<Player
									playerContainerRef={playerContainerRef}
								/>
							)
						) : (CookieBlockedPlaceholderComponent ? <CookieBlockedPlaceholderComponent /> : <div className="absolute inset-0 flex items-center justify-center bg-black text-ink-3">Loading…</div>)}
					</PlayerErrorBoundary>
				)}
			</div>
		</div>
	);
}
