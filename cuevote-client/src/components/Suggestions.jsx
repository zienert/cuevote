// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React from 'react';
import { Plus, Headphones, Check } from 'lucide-react';
import { Language } from '../contexts/LanguageContext';
import { deviceDetection } from '../utils/deviceDetection';
import { CoverImage } from './CoverImage';

const buildThumbnailUrl = (videoId) => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

export function Suggestions({ suggestions, onAdd, onPreview, queueVideoIds }) {
	const { t } = Language.useLanguage();
	const mobile = deviceDetection.isMobile();

	// Local state to track added videos to prevent duplicates/spam
	const [addedIds, setAddedIds] = React.useState(new Set());

	if (!suggestions || suggestions.length === 0) return null;

	const handleAdd = (e, videoId) => {
		e.stopPropagation();
		if (addedIds.has(videoId)) return;

		const success = onAdd(videoId);
		// If handler returns explicit false, do not mark as added
		if (success !== false) {
			setAddedIds(prev => new Set(prev).add(videoId));
		}
	};

	return (
		<>
		<div className="flex gap-4 overflow-x-auto pb-4 px-1 scroll-smooth snap-x snap-mandatory custom-scrollbar">
			{suggestions.map((video) => {
				const isAdded = queueVideoIds?.has(video.videoId);
				return (
					<div
						key={video.videoId}
						className={`group relative flex-shrink-0 w-40 snap-start bg-white/5 rounded-xl overflow-hidden hover:bg-white/10 transition-colors duration-150 cursor-pointer border border-white/5 ${isAdded ? 'opacity-50 grayscale' : ''}`}
						onClick={(e) => !isAdded && handleAdd(e, video.videoId)}
					>
						{/* Thumbnail */}
						<div className="aspect-video w-full overflow-hidden relative">
							<CoverImage
								src={video.thumbnail ?? buildThumbnailUrl(video.videoId)}
								fallbackSrc={buildThumbnailUrl(video.videoId)}
								alt={video.title}
								className="w-full h-full"
								loading="lazy"
							/>
							{/* Overlay Icons */}
							{!isAdded && (
								<div className={`absolute inset-0 transition-opacity flex items-center justify-center gap-3 ${mobile
									? "opacity-100 bg-black/30"
									: "opacity-0 group-hover:opacity-100 bg-black/60"
									}`}>
									{onPreview && (
										<button
											onClick={(e) => {
												e.stopPropagation();
												onPreview(video);
											}}
											className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-[background-color,transform] duration-150 ease-cv active:scale-95"
											title={t('track.preview')}
										>
											<Headphones size={20} />
										</button>
									)}
									<button
										onClick={(e) => handleAdd(e, video.videoId)}
										className="p-2 rounded-full bg-accent hover:bg-[#fb8b3c] text-accent-ink transition-[background-color,transform] duration-150 ease-cv active:scale-95"
										title={t('track.add')}
									>
										<Plus size={20} />
									</button>
								</div>
							)}
							{isAdded && (
								<div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-[1px]">
									<div className="bg-accent text-accent-ink rounded-full p-1 animate-in fade-in zoom-in-90 duration-200 ease-cv">
										<Check size={20} strokeWidth={3} />
									</div>
								</div>
							)}
						</div>

						{/* Info */}
						<div className="p-3">
							<h4 className="text-white text-xs font-bold line-clamp-2 leading-tight mb-1 whitespace-normal h-8" title={video.title}>
								{video.title}
							</h4>
							<p className="text-orange-400/80 text-[10px] truncate font-medium">
								{video.artist}
							</p>
						</div>
					</div>
				);
			})}
		</div>
		</>
	);
}
