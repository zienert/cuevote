// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Download, Check, X, Video, Headphones, Crown, ThumbsUp, Globe, Smartphone, ChevronUp } from 'lucide-react';
import { Language } from '../contexts/LanguageContext';

const APK_URL = "https://github.com/zienert/cuevote/releases/latest/download/app-release.apk";

// Shared grid template so the comparison header and rows align their ✓/✗ columns
// exactly; the two mark columns scale fluidly so labels keep room on tiny screens.
const COMPARE_COLS = "grid-cols-[1fr_clamp(1.9rem,9vw,2.9rem)_clamp(1.9rem,9vw,2.9rem)]";

// Android-only acquisition surface for guests on the mobile WEB version. A slim
// footer invites them to the native app; tapping it opens a comparison dialog
// that explains what the app unlocks (video, prelisten, hosting) *before* the
// APK download begins — so nobody downloads blind. iOS never renders this (it
// cannot sideload); the gating happens at the call site via isAndroid().
export const AppPromoFooter = () => {
	const { t } = Language.useLanguage();
	const [open, setOpen] = useState(false);
	const triggerRef = useRef(null);
	const dialogRef = useRef(null);

	const close = useCallback(() => {
		setOpen(false);
		triggerRef.current?.focus(); // restore focus to the trigger for keyboard/SR users
	}, []);

	// Dialog a11y: move focus into the dialog on open, close on Escape, and keep
	// Tab focus trapped inside while it is open.
	useEffect(() => {
		if (!open) return;
		dialogRef.current?.focus();
		const onKey = (e) => {
			if (e.key === 'Escape') { e.preventDefault(); close(); return; }
			if (e.key === 'Tab') {
				const els = dialogRef.current?.querySelectorAll('a[href], button:not([disabled])');
				if (!els || !els.length) return;
				const first = els[0], last = els[els.length - 1];
				if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
				else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
			}
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [open, close]);

	// browser:true → works in the mobile browser; all rows work in the native app.
	const features = [
		{ icon: ThumbsUp, label: t('mobile.featVote'), browser: true },
		{ icon: Video, label: t('mobile.featVideo'), browser: false },
		{ icon: Headphones, label: t('mobile.featPrelisten'), browser: false },
		{ icon: Crown, label: t('mobile.featHost'), browser: false },
	];

	const markBox = "flex items-center justify-center";
	const markIcon = "w-[clamp(0.95rem,4.1vw,1.15rem)] h-[clamp(0.95rem,4.1vw,1.15rem)]";

	return (
		<>
			{/* Footer bar — flows at the bottom of the venue view */}
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setOpen(true)}
				className="flex-none w-full flex items-center justify-center gap-[clamp(0.4rem,2vw,0.6rem)] px-[clamp(0.9rem,4vw,1.25rem)] py-[clamp(0.7rem,3.2vw,1rem)] bg-neutral-900/95 backdrop-blur-md border-t border-white/10 text-white active:bg-neutral-800 transition-colors select-none"
			>
				<Smartphone className="w-[clamp(1rem,4.4vw,1.25rem)] h-[clamp(1rem,4.4vw,1.25rem)] text-orange-400 shrink-0" />
				<span className="font-bold text-[clamp(0.85rem,3.6vw,1rem)] leading-tight">{t('mobile.footerCta')}</span>
				<ChevronUp className="w-[clamp(0.9rem,3.8vw,1.1rem)] h-[clamp(0.9rem,3.8vw,1.1rem)] text-neutral-400 shrink-0" />
			</button>

			{/* Pre-download comparison dialog */}
			{open && (
				<div
					className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-[clamp(0.75rem,4vw,1.5rem)] animate-in fade-in duration-200"
					role="dialog"
					aria-modal="true"
					aria-label={t('mobile.modalTitle')}
					onClick={close}
				>
					{/* On short viewports (e.g. landscape phones) the content scales down via
					    vh-based spacing; if it still doesn't fit it scrolls rather than clips. */}
					<div
						ref={dialogRef}
						tabIndex={-1}
						className="relative w-full max-w-sm rounded-2xl bg-neutral-900 border border-white/10 shadow-2xl px-[clamp(1rem,4vw,1.5rem)] py-[clamp(0.8rem,2.4vh,1.35rem)] space-y-[clamp(0.5rem,1.8vh,1.1rem)] max-h-[calc(100dvh-1.5rem)] overflow-y-auto custom-scrollbar focus:outline-none animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-300"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="text-center">
							<h2 className="text-white font-black text-[clamp(1.05rem,4.6vw,1.4rem)] tracking-tight leading-tight">{t('mobile.modalTitle')}</h2>
						</div>

						{/* Browser vs App comparison */}
						<div className="rounded-2xl bg-neutral-950/60 border border-white/10 overflow-hidden">
							<div className={`grid ${COMPARE_COLS} items-center gap-[clamp(0.4rem,2vw,0.6rem)] px-[clamp(0.7rem,3.5vw,1rem)] py-[clamp(0.3rem,1.1vh,0.6rem)] border-b border-white/10 text-[clamp(0.56rem,2.4vw,0.7rem)] font-bold uppercase tracking-wider`}>
								<span className="text-left text-neutral-500 truncate">{t('mobile.compareTitle')}</span>
								<span className={`${markBox} text-neutral-400`} title={t('mobile.colBrowser')}><Globe className="w-[clamp(0.85rem,3.7vw,1rem)] h-[clamp(0.85rem,3.7vw,1rem)]" aria-label={t('mobile.colBrowser')} /></span>
								<span className={`${markBox} text-orange-400`} title={t('mobile.colApp')}><Smartphone className="w-[clamp(0.85rem,3.7vw,1rem)] h-[clamp(0.85rem,3.7vw,1rem)]" aria-label={t('mobile.colApp')} /></span>
							</div>
							{features.map((f, i) => (
								<div key={i} className={`grid ${COMPARE_COLS} items-center gap-[clamp(0.4rem,2vw,0.6rem)] px-[clamp(0.7rem,3.5vw,1rem)] py-[clamp(0.38rem,1.45vh,0.72rem)] border-b border-white/5 last:border-0`}>
									<span className="flex items-center gap-[clamp(0.45rem,2.2vw,0.65rem)] text-left text-[clamp(0.8rem,3.3vw,0.95rem)] font-medium text-neutral-200 leading-tight">
										<f.icon className="w-[clamp(0.85rem,3.7vw,1rem)] h-[clamp(0.85rem,3.7vw,1rem)] text-neutral-400 shrink-0" />
										<span>{f.label}</span>
									</span>
									<span className={markBox}>
										{f.browser
											? <Check className={`${markIcon} text-emerald-400`} strokeWidth={3} />
											: <X className={`${markIcon} text-neutral-600`} strokeWidth={3} />}
									</span>
									<span className={markBox}>
										<Check className={`${markIcon} text-orange-400`} strokeWidth={3} />
									</span>
								</div>
							))}
						</div>

						{/* Download */}
						<div className="space-y-[clamp(0.3rem,1.2vh,0.6rem)]">
							<a
								href={APK_URL}
								download="CueVote-App.apk"
								target="_blank"
								rel="noopener noreferrer"
								onClick={close}
								className="relative w-full py-[clamp(0.5rem,1.9vh,0.95rem)] px-[clamp(2.6rem,12vw,3.25rem)] rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 text-white font-bold text-[clamp(0.95rem,3.9vw,1.125rem)] shadow-xl hover:shadow-orange-500/30 active:scale-95 transition-all duration-200 flex items-center justify-center text-center leading-tight"
							>
								<Download className="absolute left-[clamp(0.85rem,4.5vw,1.25rem)] top-1/2 -translate-y-1/2 w-[clamp(1.05rem,4.6vw,1.4rem)] h-[clamp(1.05rem,4.6vw,1.4rem)] fill-current" />
								<span>{t('mobile.downloadMobile')}</span>
							</a>
							<p className="text-[clamp(0.62rem,2.7vw,0.75rem)] text-neutral-500 leading-snug text-center">
								{t('mobile.requirement')} · <span className="opacity-70">{t('mobile.downloadFail')}</span> {t('mobile.installInstruction')}
							</p>
						</div>

						<button
							type="button"
							onClick={close}
							className="w-full py-[clamp(0.3rem,1.3vh,0.7rem)] text-neutral-400 hover:text-white font-semibold text-[clamp(0.85rem,3.5vw,1rem)] transition-colors"
						>
							{t('mobile.later')}
						</button>
					</div>
				</div>
			)}
		</>
	);
};
