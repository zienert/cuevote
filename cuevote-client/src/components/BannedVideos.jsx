// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React from 'react';
import { Ban, X, ArrowLeft, CheckCircle } from 'lucide-react';
import { Language } from '../contexts/LanguageContext';
import { YouTubeBrandSubtitle } from './YouTubeBrandSubtitle';

// showYouTubeAttribution: off in Apple Music channels, which play nothing from YouTube.
export function BannedVideosPage({ bannedVideos, onUnban, onClose, showYouTubeAttribution = true }) {
	const { t } = Language.useLanguage();
	return (
		<div className="fixed inset-0 z-[60] bg-black/95 backdrop-blur-sm flex flex-col animate-in fade-in">
			<div className="p-6 border-b border-neutral-800 flex items-center gap-4 bg-black">
				<button
					onClick={onClose}
					className="p-2 rounded-full hover:bg-neutral-800 text-white transition-colors"
				>
					<ArrowLeft size={24} />
				</button>
				<div className="flex flex-col">
					<h1 className="text-2xl font-bold text-white flex items-center gap-3">
						<Ban className="text-red-500" />
						{t('banned.title')}
						<span className="text-lg font-normal text-neutral-500">
							({bannedVideos.length})
						</span>
					</h1>
					{showYouTubeAttribution && <YouTubeBrandSubtitle className="ml-9" />}
				</div>
			</div>

			<div className="flex-1 overflow-y-auto p-6 max-w-6xl mx-auto w-full">
				{(!bannedVideos || bannedVideos.length === 0) ? (
					<div className="text-center text-neutral-500 mt-20">
						<p className="text-xl">{t('banned.empty')}</p>
						<p className="text-sm mt-2">{t('banned.emptySubtitle')}</p>
					</div>
				) : (
					<div className="grid gap-4">
						{bannedVideos.map((track) => (
							<div key={track.videoId} className="bg-neutral-900 border border-neutral-800 rounded-xl p-3 sm:p-4 flex items-start justify-between gap-3 sm:gap-4 hover:border-neutral-700 transition-colors">
								<div className="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
									<div className="w-16 h-12 sm:w-24 sm:h-16 rounded-lg bg-neutral-800 flex items-center justify-center flex-shrink-0 shadow-sm border border-neutral-700">
										<Ban size={24} className="text-neutral-500" />
									</div>

									<div className="flex-1 min-w-0">
										<h3 className="text-sm sm:text-lg font-bold text-white line-clamp-2 leading-tight" title={track.title}>{track.title}</h3>
										<p className="text-xs sm:text-base text-neutral-400 truncate">{track.artist}</p>
										<p className="text-xs sm:text-sm text-neutral-500 mt-0.5 sm:mt-1">
												{t('banned.bannedOn', { date: new Date(track.bannedAt).toLocaleDateString() })}
										</p>
									</div>
								</div>

								<div className="flex items-center gap-2 flex-shrink-0 sm:pl-4 pt-1 sm:pt-0">
									<button
										onClick={() => onUnban(track.videoId)}
										className="p-2 sm:px-4 sm:py-2 rounded-lg bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors font-medium flex items-center gap-2 border border-neutral-700"
										title={t('banned.unban')}
									>
										<CheckCircle size={18} /> <span className="hidden sm:inline">{t('banned.unban')}</span>
									</button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
