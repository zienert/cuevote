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
				className="w-full max-w-5xl aspect-video max-h-full bg-black rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10 relative"
			>
				{isTooSmall ? (
					<div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black p-4 text-center animate-fadeIn">
						<div className="mx-auto w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-500 mb-3">
							<Maximize2 size={20} />
						</div>
						<h2 className="text-sm font-bold text-white mb-1">Window Too Small</h2>
						<p className="text-xs text-neutral-400">
							Resize to view
						</p>
					</div>
				) : (
					<PlayerErrorBoundary>
						{hasConsent ? (
							playbackError ? (
								<div className="w-full h-full flex flex-col items-center justify-center bg-neutral-900 text-center p-6 space-y-4">
									<div className="w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center text-neutral-400">
										<AlertTriangle size={24} />
									</div>
									<div>
										<p className="text-white font-medium mb-1">
											{playbackError === 100 ? t('player.errorNotFound') : (playbackError === 101 || playbackError === 150 ? t('player.errorRestricted') : t('player.errorGeneric'))}
										</p>
									</div>
								</div>
							) : (
								<Player
									playerContainerRef={playerContainerRef}
								/>
							)
						) : (CookieBlockedPlaceholderComponent ? <CookieBlockedPlaceholderComponent /> : <div className="absolute inset-0 flex items-center justify-center bg-black text-neutral-500">Loading…</div>)}
					</PlayerErrorBoundary>
				)}
			</div>
		</div>
	);
}
