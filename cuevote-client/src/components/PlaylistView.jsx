// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Language } from '../contexts/LanguageContext';
import { Track } from "./Track";
import { ChannelLibrary } from "./ChannelLibrary";

export function PlaylistView({
    history,
    currentTrack,
    queue,
    onVote,
    votes,
    votesEnabled = true,
    onPreview,
    onDelete,
    onRecommend,
    onAdd,
    activeSuggestionId,
    suggestions,
    isFetchingSuggestions,
    queueVideoIds,
    disableFloatingUI = false,
    onLibraryDelete,
    activeTab = "playlist",
    appFooterPresent = false,
}) {
    const scrollRef = useRef(null);
    const [expandedTrackId, setExpandedTrackId] = useState(null);
    const [showJumpToNow, setShowJumpToNow] = useState(false);
    const [jumpDirection, setJumpDirection] = useState("down");
    const { t } = Language.useLanguage();

    const handleToggleExpand = (trackId) => {
        setExpandedTrackId((prev) => (prev === trackId ? null : trackId));
    };

    const scrollToCurrent = (smooth = true) => {
        const container = scrollRef.current;
        if (container) {
            const currentEl = document.getElementById("playlist-current-track");
            if (currentEl) {
                setShowJumpToNow(false);
                const containerRect = container.getBoundingClientRect();
                const elementRect = currentEl.getBoundingClientRect();
                const scrollTop = container.scrollTop + elementRect.top - containerRect.top - containerRect.height / 2 + elementRect.height / 2;
                container.scrollTo({ top: scrollTop, behavior: smooth ? "smooth" : "auto" });
            }
        }
    };

    useEffect(() => {
        if (activeTab !== "playlist") return;
        const currentEl = document.getElementById("playlist-current-track");
        if (!currentEl) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                const isVisible = entry.isIntersecting;
                setShowJumpToNow(!isVisible);

                if (!isVisible) {
                    const { top } = entry.boundingClientRect;
                    setJumpDirection(top < 0 ? "up" : "down");
                }
            },
            {
                root: scrollRef.current,
                threshold: 0
            }
        );

        observer.observe(currentEl);

        return () => {
            observer.disconnect();
        };
    }, [currentTrack?.id, activeTab]);

    useEffect(() => {
        if (activeTab !== "playlist") return;
        if (!showJumpToNow) {
            scrollToCurrent();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentTrack?.id, activeTab]);

    const filteredQueue = queue.filter(t => t.id !== currentTrack?.id);

    const isLibrary = activeTab === "library";

    return (
        <div className="flex flex-col h-full bg-[#0a0a0a] text-white relative">
            {isLibrary ? (
                <div className="flex-1 min-h-0">
                    <ChannelLibrary
                            history={history}
                            onAdd={onAdd}
                            onDelete={onLibraryDelete}
                            onPreview={onPreview}
                            onRecommend={onRecommend}
                            activeSuggestionId={activeSuggestionId}
                            suggestions={suggestions}
                            isFetchingSuggestions={isFetchingSuggestions}
                            queueVideoIds={queueVideoIds}
                        />
                </div>
            ) : (
                <div
                    className="flex-1 overflow-y-auto pb-24 custom-scrollbar scroll-smooth relative"
                    ref={scrollRef}
                >
                    <div className="max-w-3xl mx-auto space-y-4 py-4 px-4">
                        {/* History */}
                        {history.length > 0 && (
                            <div className="space-y-2 opacity-60 hover:opacity-100 transition-opacity duration-300">
                                <div className="flex items-center gap-2 px-2 pb-2 border-b border-neutral-800">
                                    <span className="text-xs font-bold text-neutral-600 uppercase tracking-widest">{t('playlist.history')}</span>
                                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-neutral-900 text-neutral-600 font-mono">
                                        {history.length > 50 ? t('playlist.last50', { count: history.length }) : history.length}
                                    </span>
                                </div>
                                {history.slice(-50).map((track, i) => (
                                    <Track
                                        key={`hist-${track.id}-${i}`}
                                        track={track}
                                        isActive={false}
                                        isExpanded={expandedTrackId === `hist-${track.id}-${i}`}
                                        vote={null}
                                        onVote={() => { }}
                                        onToggleExpand={() => handleToggleExpand(`hist-${track.id}-${i}`)}
                                        readOnly={true}
                                        votesEnabled={votesEnabled}
                                        onRecommend={onRecommend}
                                        onAdd={onAdd}
                                        onAddSuggestion={onAdd}
                                        onPreview={onPreview}
                                        activeSuggestionId={activeSuggestionId}
                                        suggestions={suggestions}
                                        isFetchingSuggestions={isFetchingSuggestions}
                                        queueVideoIds={queueVideoIds}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Current Track */}
                        {currentTrack && (
                            <div id="playlist-current-track" className="space-y-2 py-4">
                                <div className="flex items-center gap-2 px-2 pb-2">
                                    <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                                    <span className="text-xs font-bold text-orange-500 uppercase tracking-widest">{t('playlist.nowPlaying')}</span>
                                </div>
                                <Track
                                    track={currentTrack}
                                    isActive={true}
                                    isExpanded={expandedTrackId === currentTrack.id}
                                    vote={votes?.[currentTrack.id] || null}
                                    onVote={onVote}
                                    onToggleExpand={handleToggleExpand}
                                    readOnly={true}
                                    votesEnabled={votesEnabled}
                                    onDelete={onDelete}
                                    onRecommend={onRecommend}
                                    onAdd={onAdd}
                                    activeSuggestionId={activeSuggestionId}
                                    suggestions={suggestions}
                                    isFetchingSuggestions={isFetchingSuggestions}
                                    queueVideoIds={queueVideoIds}
                                />
                            </div>
                        )}

                        {/* Queue */}
                        {filteredQueue.length > 0 ? (
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 px-2 pb-2 border-b border-neutral-800 mt-4">
                                    <span className="text-xs font-bold text-neutral-400 uppercase tracking-widest">{t('playlist.upNext')}</span>
                                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-neutral-800 text-neutral-400 font-mono">{filteredQueue.length}</span>
                                </div>
                                {filteredQueue.map((track) => (
                                    <Track
                                        key={track.id}
                                        track={track}
                                        isActive={false}
                                        isExpanded={expandedTrackId === track.id}
                                        vote={votes?.[track.id]}
                                        onVote={onVote}
                                        onToggleExpand={handleToggleExpand}
                                        readOnly={false}
                                        votesEnabled={votesEnabled}
                                        onPreview={onPreview}
                                        onDelete={onDelete}
                                        onRecommend={onRecommend}
                                        onAdd={onAdd}
                                        activeSuggestionId={activeSuggestionId}
                                        suggestions={suggestions}
                                        isFetchingSuggestions={isFetchingSuggestions}
                                        queueVideoIds={queueVideoIds}
                                    />
                                ))}
                            </div>
                        ) : (
                            !currentTrack && (
                                <div className="flex h-64 w-full items-center justify-center text-neutral-500 bg-[#0a0a0a]">
                                    <span className="text-lg">{t('playlist.queueEmpty')}</span>
                                </div>
                            )
                        )}
                    </div>
                </div>
            )}

            {/* Back to Now Button - only in playlist tab.
                When the Android app footer is present, bottom-20 lifts this clear of
                AppPromoFooter (~52px tall) — keep in sync if that footer's height changes.
                The margin keeps it clear of the room's bar when that sits at the bottom. */}
            {!isLibrary && showJumpToNow && currentTrack && !disableFloatingUI && createPortal(
                <div
                    className={`fixed ${appFooterPresent ? 'bottom-20' : 'bottom-8'} right-8 z-[100] animate-fadeIn`}
                    style={{ marginBottom: 'var(--bottom-bar-h, 0px)' }}
                >
                    <button
                        onClick={() => scrollToCurrent(true)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-orange-500 text-white rounded-full shadow-lg hover:bg-orange-600 hover:shadow-xl transition-all hover:-translate-y-0.5 active:translate-y-0 font-medium text-sm"
                    >
                        <span>{t('playlist.backToNow')}</span>
                        {jumpDirection === 'up' ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
                    </button>
                </div>,
                document.body
            )}
        </div>
    );
}

PlaylistView.propTypes = {
    appFooterPresent: PropTypes.bool,
    history: PropTypes.array,
    currentTrack: PropTypes.object,
    queue: PropTypes.array,
    user: PropTypes.object,
    onVote: PropTypes.func,
    votes: PropTypes.object,
    isOwner: PropTypes.bool,
    votesEnabled: PropTypes.bool,
    onPreview: PropTypes.func,
    onRecommend: PropTypes.func,
    onAdd: PropTypes.func,
    activeSuggestionId: PropTypes.string,
    suggestions: PropTypes.array,
    isFetchingSuggestions: PropTypes.bool,
    queueVideoIds: PropTypes.oneOfType([PropTypes.array, PropTypes.instanceOf(Set)]),
    disableFloatingUI: PropTypes.bool,
    onLibraryDelete: PropTypes.func,
    activeTab: PropTypes.string,
};
