// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React from "react";
import PropTypes from "prop-types";
import { Track } from "./Track";
import { Language } from '../contexts/LanguageContext';

export function Queue({
  tracks,
  currentTrack,
  expandedTrackId,
  votes,
  onVote,
  onToggleExpand,
  isMinimized,
  onPreview,
  votesEnabled = true,
  onDelete,
  onRecommend,
  onAdd,
  activeSuggestionId,
  suggestions,
  isFetchingSuggestions,
  queueVideoIds
}) {
  const { t } = Language.useLanguage();
  // Filter out current track as it is shown in the bottom bar
  const visibleTracks = tracks.filter(t => t.id !== currentTrack?.id);

  return (
    <div
      className={`relative mx-auto w-full max-w-3xl transition-[opacity,transform] duration-300 ease-cv ${isMinimized
        ? "max-h-0 translate-y-3 overflow-hidden opacity-0"
        : "translate-y-0 space-y-1 px-3 py-4 opacity-100 sm:px-4"
        }`}
    >
      {!isMinimized && visibleTracks.length > 0 && (
        <div className="flex items-baseline gap-2 px-3 pb-1">
          <span className="text-[13px] font-medium text-ink-2">{t('playlist.upNext')}</span>
          <span className="text-[13px] tabular-nums text-ink-3">{visibleTracks.length}</span>
        </div>
      )}
      {visibleTracks.map((track) => (
        <div key={track.id} id={`track-${track.id}`}>
          <Track
            track={track}
            isActive={false} // Never active in this list
            isExpanded={expandedTrackId === track.id}
            vote={votes[track.id]}
            onVote={onVote}
            onToggleExpand={onToggleExpand}
            onPreview={onPreview}
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
      ))}

      {/* "Back to Now" removed as current track is not in list */}
    </div>
  );
}

Queue.propTypes = {
  tracks: PropTypes.array.isRequired,
  currentTrack: PropTypes.object,
  expandedTrackId: PropTypes.string,
  votes: PropTypes.object.isRequired,
  onVote: PropTypes.func.isRequired,
  onToggleExpand: PropTypes.func.isRequired,
  isMinimized: PropTypes.bool.isRequired,
  onPreview: PropTypes.func,
  votesEnabled: PropTypes.bool,
  onDelete: PropTypes.func,
  onRecommend: PropTypes.func,
  onAdd: PropTypes.func,
  activeSuggestionId: PropTypes.string,
  suggestions: PropTypes.array,
  isFetchingSuggestions: PropTypes.bool,
};
