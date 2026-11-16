// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React from 'react';
import { Ban, ChevronLeft, Undo2 } from 'lucide-react';
import { Language } from '../contexts/LanguageContext';
import { YouTubeBrandSubtitle } from './YouTubeBrandSubtitle';

// showYouTubeAttribution: off in Apple Music channels, which play nothing from YouTube.
export function BannedVideosPage({ bannedVideos, onUnban, onClose, showYouTubeAttribution = true }) {
	const { t, language } = Language.useLanguage();
	// Serbian is written in Latin script here; a bare "sr" formats in Cyrillic.
	const dateLocale = language === 'sr' ? 'sr-Latn' : language;
	return (
		<div className="fixed inset-0 z-[60] flex flex-col bg-page text-ink animate-in fade-in duration-200">
			<div className="flex items-center gap-3 border-b border-line px-3 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-6">
				<button
					onClick={onClose}
					className="cv-hit -ml-1 flex h-10 flex-none items-center gap-1 rounded-lg pl-1 pr-3 text-sm font-medium text-ink-2 transition-colors duration-150 hover:bg-raised hover:text-ink"
				>
					<ChevronLeft size={18} aria-hidden="true" />
					{t('header.back')}
				</button>
				<div className="h-5 w-px flex-none bg-line" aria-hidden="true" />
				<div className="min-w-0">
					<h1 className="flex items-baseline gap-2 text-base font-semibold text-ink">
						<span className="truncate">{t('banned.title')}</span>
						<span className="font-normal tabular-nums text-ink-3">{bannedVideos.length}</span>
					</h1>
					{showYouTubeAttribution && <YouTubeBrandSubtitle />}
				</div>
			</div>

			<div className="custom-scrollbar flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6">
				{(!bannedVideos || bannedVideos.length === 0) ? (
					<div className="mt-16 text-center">
						<p className="text-base font-medium text-ink">{t('banned.empty')}</p>
						<p className="mt-1.5 text-sm text-ink-2">{t('banned.emptySubtitle')}</p>
					</div>
				) : (
					<div className="mx-auto w-full max-w-3xl space-y-1">
						{bannedVideos.map((track) => (
							<div key={track.videoId} className="flex items-center gap-3 rounded-xl bg-card px-3 py-2.5">
								<div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-raised">
									<Ban size={20} className="text-ink-3" aria-hidden="true" />
								</div>

								<div className="min-w-0 flex-1">
									<h3 dir="auto" className="cv-bidi line-clamp-2 break-words text-[15px] font-medium leading-5 text-ink" title={track.title}>{track.title}</h3>
									<p dir="auto" className="cv-bidi truncate text-[13px] leading-5 text-ink-2">{track.artist}</p>
									<p className="text-xs leading-5 text-ink-3">
										{t('banned.bannedOn', { date: new Date(track.bannedAt).toLocaleDateString(dateLocale) })}
									</p>
								</div>

								<button
									onClick={() => onUnban(track.videoId)}
									title={t('banned.unban')}
									aria-label={t('banned.unban')}
									className="cv-btn cv-btn-quiet cv-hit h-9 flex-none rounded-full px-3 text-[13px] max-sm:w-9 max-sm:px-0"
								>
									<Undo2 size={16} aria-hidden="true" />
									<span className="max-sm:hidden">{t('banned.unban')}</span>
								</button>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
