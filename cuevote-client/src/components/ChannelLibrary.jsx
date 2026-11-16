// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useMemo, useState, useRef, useEffect } from "react";
import PropTypes from "prop-types";
import { Search, Music2, ChevronDown } from "lucide-react";
import { Language } from '../contexts/LanguageContext';
import { dangerousHtml } from '../utils/sanitizeHtml';
import { Track } from "./Track";

export function ChannelLibrary({
	history = [],
	onAdd, // New prop to add video to queue
	onDelete,
	onPreview,
	onRecommend,
	activeSuggestionId,
	suggestions,
	isFetchingSuggestions,
	queueVideoIds,
}) {
	const [searchQuery, setSearchQuery] = useState("");
	const [expandedTrackId, setExpandedTrackId] = useState(null);
	// What the library holds and why older videos leave it: closed until asked for.
	const [aboutOpen, setAboutOpen] = useState(false);
	const { t } = Language.useLanguage();

	// Infinite Scroll State
	const [displayedCount, setDisplayedCount] = useState(50);
	const observerTarget = useRef(null);

	const handleToggleExpand = (trackId) => {
		setExpandedTrackId((prev) => (prev === trackId ? null : trackId));
	};

	// Deduplicate history to get unique songs
	// Only valid if videoId is present
	const uniqueVideos = useMemo(() => {
		const map = new Map();
		history.forEach(track => {
			if (track.videoId && !map.has(track.videoId)) {
				map.set(track.videoId, track);
			}
		});
		return Array.from(map.values()).reverse();
	}, [history]);

	const filteredVideos = useMemo(() => {
		const now = Date.now();
		const TWENTY_EIGHT_DAYS_MS = 28 * 24 * 60 * 60 * 1000;

		let result = uniqueVideos.filter(video => {
			if (!video.playedAt) return false;
			const age = now - video.playedAt;
			return age < TWENTY_EIGHT_DAYS_MS;
		});

		if (searchQuery.trim()) {
			const lowerQ = searchQuery.toLowerCase();
			result = result.filter(video =>
				(video.title && video.title.toLowerCase().includes(lowerQ)) ||
				(video.artist && video.artist.toLowerCase().includes(lowerQ))
			);
		}

		return result;
	}, [uniqueVideos, searchQuery]);

	// Reset displayed count when search changes
	useEffect(() => {
		setDisplayedCount(50);
	}, [searchQuery]);

	const visibleVideos = useMemo(() => {
		return filteredVideos.slice(0, displayedCount);
	}, [filteredVideos, displayedCount]);

	useEffect(() => {
		const target = observerTarget.current;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting && displayedCount < filteredVideos.length) {
					console.log("Loading more items...");
					setDisplayedCount((prev) => prev + 50);
				}
			},
			{ threshold: 0.1 } // Trigger when 10% of sentinel is visible
		);

		if (target) {
			observer.observe(target);
		}

		return () => {
			if (target) {
				observer.unobserve(target);
			}
		};
	}, [displayedCount, filteredVideos.length]);


	return (
		<div className="flex h-full w-full flex-col bg-page text-ink">

			{/* Search, the count, and the explanation behind a small switch */}
			<div className="border-b border-line px-3 py-3 sm:px-4">
				<div className="mx-auto max-w-3xl">
					<div className="relative">
						<Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" size={18} aria-hidden="true" />
						<input
							type="text"
							placeholder={t('library.searchPlaceholder')}
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="block h-11 w-full rounded-xl border border-line bg-card pl-10 pr-3 text-base text-ink placeholder:text-ink-3 transition-[border-color,box-shadow] duration-150 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent/70 sm:h-10 sm:text-sm"
						/>
					</div>
					<div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1">
						<p className="text-[13px] text-ink-2">
							<span className="font-medium tabular-nums text-accent">
								{t('library.videos', { count: filteredVideos.length })}
							</span>{' '}
							{t('library.inLibrary')}
						</p>
						{!searchQuery && (
							<button
								type="button"
								aria-expanded={aboutOpen}
								aria-controls="library-about"
								onClick={() => setAboutOpen((open) => !open)}
								className="cv-hit flex flex-none items-center gap-1 rounded-md text-[13px] text-ink-2 transition-colors duration-150 hover:text-ink"
							>
								{t('library.about')}
								<ChevronDown size={14} className={`transition-transform duration-150 ${aboutOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
							</button>
						)}
					</div>
					{!searchQuery && (
						<div
							id="library-about"
							className={`grid transition-[grid-template-rows] duration-200 ease-cv motion-reduce:transition-none ${aboutOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
						>
							<div className="min-h-0 overflow-hidden" inert={!aboutOpen}>
								<div className="space-y-2 px-1 pt-3 text-[13px] leading-relaxed text-ink-2 [&_strong]:font-medium [&_strong]:text-ink">
									<p dangerouslySetInnerHTML={dangerousHtml(t('library.info1'))}></p>
									<p dangerouslySetInnerHTML={dangerousHtml(t('library.info2'))}></p>
								</div>
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Content */}
			<div className="custom-scrollbar flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-4">
				<div className="mx-auto max-w-3xl space-y-1">
					{visibleVideos.length > 0 ? (
						<>
							{visibleVideos.map((track, i) => (
								<Track
									key={`lib-${track.videoId}-${i}`}
									track={track}
									isActive={false}
									isExpanded={expandedTrackId === `lib-${track.videoId}-${i}`}
									readOnly={true}
									votesEnabled={false}
									onToggleExpand={() => handleToggleExpand(`lib-${track.videoId}-${i}`)}
									// Pass onAdd directly, Track ensures ID is passed
									onAdd={onAdd}
									onDelete={onDelete ? () => onDelete(track.videoId) : undefined}
									onPreview={onPreview}
									onRecommend={onRecommend}
									activeSuggestionId={activeSuggestionId}
									suggestions={suggestions}
									isFetchingSuggestions={isFetchingSuggestions}
									queueVideoIds={queueVideoIds}
								/>
							))}
							{/* Sentinel for Infinite Scroll */}
							<div ref={observerTarget} className="h-4 w-full" />
						</>
					) : (
						<div className="flex flex-col items-center justify-center gap-3 py-16 text-ink-2">
							<Music2 size={32} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />
							<p className="text-sm">{t('library.empty')}</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

ChannelLibrary.propTypes = {
	history: PropTypes.array.isRequired,
	onAdd: PropTypes.func,
	onDelete: PropTypes.func,
	onPreview: PropTypes.func,
	onRecommend: PropTypes.func,
	activeSuggestionId: PropTypes.string,
	suggestions: PropTypes.array,
	isFetchingSuggestions: PropTypes.bool,
	queueVideoIds: PropTypes.array,
};
