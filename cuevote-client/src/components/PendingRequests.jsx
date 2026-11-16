// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert

import React from 'react';
import { Check, X, Clock, ChevronLeft, Ban, Headphones } from 'lucide-react';
import { Language } from '../contexts/LanguageContext';
import { YouTubeBrandSubtitle } from './YouTubeBrandSubtitle';
import { RequestAction as Action, RequestSummary as Request } from './RequestParts';

// Single export with inline components so bundler cannot reorder and cause TDZ.
export const PendingRequestsExports = {
	PendingRequests({ requests, onApprove, onReject, onBan, onPreview, onClose }) {
		const { t } = Language.useLanguage();
		if (!requests || requests.length === 0) return null;
		return (
		<div
			className="fixed bottom-20 left-3 right-3 z-30 overflow-hidden rounded-2xl border border-line bg-card shadow-2xl shadow-black/60 animate-in fade-in slide-in-from-bottom-2 duration-200 sm:bottom-24 sm:left-auto sm:right-6 sm:w-[450px]"
			// Clear of the room's bar at the bottom of a phone.
			style={{ marginBottom: 'var(--bottom-bar-h, 0px)' }}
		>
			<div className="flex items-center justify-between gap-2 border-b border-line py-1.5 pl-3 pr-1.5">
				<h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
					<Clock size={16} className="flex-none text-accent" aria-hidden="true" />
					<span className="truncate">{t('pending.pendingReview')}</span>
					<span className="font-normal tabular-nums text-ink-3">{requests.length}</span>
				</h3>
				<button
					onClick={onClose}
					title={t('header.close')}
					aria-label={t('header.close')}
					className="cv-hit flex h-8 w-8 flex-none items-center justify-center rounded-lg text-ink-2 transition-colors duration-150 hover:bg-raised hover:text-ink"
				>
					<X size={16} aria-hidden="true" />
				</button>
			</div>

			<div className="custom-scrollbar max-h-60 overflow-y-auto overscroll-contain">
				{requests.map((track) => (
					<div key={track.id} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
						<Request track={track} t={t} coverClass="h-10 w-10" />
						<div className="flex flex-none items-center gap-1">
							{onPreview && <Action icon={Headphones} label={t('pending.preview')} onClick={() => onPreview(track)} />}
							<Action icon={Ban} label={t('pending.ban')} tone="danger" onClick={() => onBan(track.id)} />
							<Action icon={X} label={t('pending.decline')} tone="danger" onClick={() => onReject(track.id)} />
							<Action icon={Check} label={t('pending.accept')} tone="accept" onClick={() => onApprove(track.id)} />
						</div>
					</div>
				))}
			</div>
		</div>
		);
	},
	// showYouTubeAttribution: off in Apple Music channels, which play nothing from YouTube.
	PendingRequestsPage({ requests, onApprove, onReject, onBan, onManageBanned, onPreview, onClose, showYouTubeAttribution = true }) {
		const { t } = Language.useLanguage();
		return (
		<div className="fixed inset-0 z-[60] flex flex-col bg-page text-ink animate-in fade-in duration-200">
			<div className="flex items-center justify-between gap-3 border-b border-line px-3 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-6">
				<div className="flex min-w-0 items-center gap-3">
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
							<span className="truncate">{t('pending.title')}</span>
							<span className="font-normal tabular-nums text-ink-3">{requests.length}</span>
						</h1>
						{showYouTubeAttribution && <YouTubeBrandSubtitle />}
					</div>
				</div>
				<button
					onClick={onManageBanned}
					title={t('pending.bannedVideos')}
					aria-label={t('pending.bannedVideos')}
					className="cv-btn cv-btn-quiet cv-hit h-10 flex-none px-3"
				>
					<Ban size={16} className="text-ink-2" aria-hidden="true" />
					<span className="max-sm:hidden">{t('pending.bannedVideos')}</span>
				</button>
			</div>

			<div className="custom-scrollbar flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6">
				{(!requests || requests.length === 0) ? (
					<div className="mt-16 text-center">
						<p className="text-base font-medium text-ink">{t('pending.empty')}</p>
						<p className="mt-1.5 text-sm text-ink-2">{t('pending.emptySubtitle')}</p>
					</div>
				) : (
					<div className="mx-auto w-full max-w-3xl space-y-1">
						{requests.map((track) => (
							<div key={track.id} className="rounded-xl bg-card px-3 py-2.5">
								<div className="flex items-center gap-3">
									<Request track={track} t={t} coverClass="h-12 w-12" />
									{/* From a tablet up the actions sit in the row. */}
									<div className="flex flex-none items-center gap-1.5 max-sm:hidden">
										{onPreview && <Action icon={Headphones} label={t('pending.preview')} onClick={() => onPreview(track)} />}
										<Action icon={Ban} label={t('pending.ban')} tone="danger" onClick={() => onBan(track.id)} />
										<Action icon={X} label={t('pending.decline')} tone="danger" withLabel onClick={() => onReject(track.id)} />
										<Action icon={Check} label={t('pending.accept')} tone="accept" withLabel onClick={() => onApprove(track.id)} />
									</div>
								</div>
								{/* On a phone they get a line of their own: nothing is cut off,
								    and accepting carries its word. */}
								<div className="mt-2.5 flex items-center justify-between gap-2 sm:hidden">
									<div className="flex items-center gap-1.5">
										{onPreview && <Action icon={Headphones} label={t('pending.preview')} onClick={() => onPreview(track)} />}
										<Action icon={Ban} label={t('pending.ban')} tone="danger" onClick={() => onBan(track.id)} />
										<Action icon={X} label={t('pending.decline')} tone="danger" onClick={() => onReject(track.id)} />
									</div>
									<Action icon={Check} label={t('pending.accept')} tone="accept" withLabel onClick={() => onApprove(track.id)} />
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
		);
	},
};
