// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useState } from "react";
import PropTypes from "prop-types";
import { ThumbsUp, ThumbsDown, Headphones, Trash2, Loader2, UserRound } from "lucide-react";
import { Language } from '../contexts/LanguageContext';
import { Consent } from '../contexts/ConsentContext';
import { Suggestions } from "./Suggestions";
import { Skeleton } from "./Skeleton";
import { CoverImage } from "./CoverImage";
import { suggesterLabel } from "../utils/participation";
import { isAppleKey } from "../utils/trackKeys";

const buildWatchUrl = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;
const buildThumbnailUrl = (videoId) => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

// One row of a list: the cover, the title over the artist, who suggested it,
// and the vote. A tap opens what can be done with the track.
export function Track({
  track,
  isActive,
  isExpanded,
  vote,
  onVote,
  onToggleExpand,
  onPreview,
  readOnly = false,
  votesEnabled = true,
  onDelete,
  onAdd,
  onAddSuggestion, // <--- New Prop for separation of concerns
  onRecommend,
  activeSuggestionId, // <--- New Prop
  suggestions,        // <--- New Prop
  isFetchingSuggestions, // <--- New Prop
  queueVideoIds       // <--- New Prop
}) {
  // Check prioritized status
  const isPriority = track.isOwnerPriority;
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isActiveSuggestion = activeSuggestionId === track.id; // Check if active


  const { t } = Language.useLanguage();
  const { hasConsent, hasAppleConsent } = Consent.useConsent();

  // Apple Music artwork may appear with playback or playlists (current track,
  // queue, history, library), never on its own like in the lobby. Apple items
  // have no YouTube thumbnail or watch page to fall back to.
  const isApple = isAppleKey(track.videoId);
  const thumbnailSrc = track.thumbnail ?? (isApple ? null : buildThumbnailUrl(track.videoId));

  const score = track.score || 0;
  const suggester = suggesterLabel(track, t);
  // Next to the person icon a guest's tag says enough.
  const suggesterShort = track.suggestedByIsGuest && track.suggestedByGuestTag ? track.suggestedByGuestTag : suggester;
  const showVotes = !readOnly && votesEnabled && !isActive;
  // A fingertip needs 44 px; a mouse pointer gets by with less.
  const voteButton = "flex h-11 w-11 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 ease-cv active:scale-90 sm:h-9 sm:w-9";
  const actionButton = "cv-btn h-11 w-full";

  return (
    <div
      onClick={() => onToggleExpand(track.id)}
      className={`cursor-pointer overflow-hidden rounded-xl px-3 py-2 transition-colors duration-150 ${isActive || isExpanded
        ? "bg-raised"
        : "bg-card hover:bg-raised"
        } ${isActive
          ? "ring-1 ring-inset ring-accent/50"
          : isPriority
            ? "ring-1 ring-inset ring-accent/30"
            : isExpanded
              ? "ring-1 ring-inset ring-line"
              : ""
        }`}
    >
      <div className="flex items-center gap-3">
        {/* The cover and the title are the button that opens the row: a
            keyboard, a screen reader and a TV remote reach it. A click
            anywhere else in the row does the same. */}
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpand(track.id);
          }}
          className="-my-2 flex min-w-0 flex-1 items-center gap-3 rounded-lg py-2 text-left focus-visible:-outline-offset-2"
        >
        {!track.title ? (
          // Metadata still loading — cleared by the 28-day cleanup, refilled on
          // join. Don't show YouTube imagery until we have fresh metadata.
          <div className="skeleton h-12 w-12 flex-shrink-0 rounded-lg bg-raised" aria-hidden="true" />
        ) : (isApple ? hasAppleConsent : hasConsent) && thumbnailSrc ? (
          <CoverImage
            src={thumbnailSrc}
            fallbackSrc={isApple ? undefined : buildThumbnailUrl(track.videoId)}
            alt={track.title}
            className="h-12 w-12 flex-shrink-0 rounded-lg"
            loading="lazy"
          />
        ) : (
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-raised">
            <Headphones size={20} className="text-ink-3" />
          </div>
        )}

        <span className="block min-w-0 flex-1">
          {track.title ? (
            // One line in the list; the whole title once the row is open.
            <span className={`block text-[15px] font-medium leading-5 text-ink ${isExpanded ? "break-words" : "truncate"}`}>
              {track.title}
            </span>
          ) : (
            // Title cleared after YouTube's 28-day metadata limit — re-fetched
            // on join. Skeleton bridges the brief gap instead of showing "null".
            <Skeleton className="h-4 w-40 max-w-full" />
          )}
          {track.artist ? (
            <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[13px] leading-5 text-ink-2">
              <span className={isExpanded ? "min-w-0 break-words" : "truncate"}>{track.artist}</span>
              {/* Phones: who suggested it sits here, where a row with votes
                  has no room for it on the right. */}
              {suggester && showVotes && (
                <span className="flex flex-shrink-0 items-center gap-1 text-xs text-ink-3 sm:hidden">
                  <UserRound size={12} aria-hidden="true" />
                  <span className="max-w-[5.5rem] truncate">{suggesterShort}</span>
                </span>
              )}
            </span>
          ) : isActive ? null : (
            <Skeleton className="mt-1.5 h-3.5 w-24 max-w-full" />
          )}
        </span>

        {suggester && (
          <span className={`max-w-[6.5rem] flex-shrink-0 truncate text-xs text-ink-3 ${showVotes ? "max-sm:hidden" : ""}`}>
            {suggester}
          </span>
        )}
        </button>

        {showVotes && (
          <div className="flex flex-shrink-0 items-center">
            <button
              onClick={(event) => {
                event.stopPropagation();
                onVote(track.id, "up");
              }}
              aria-pressed={vote === "up"}
              aria-label={t('track.voteUp')}
              title={t('track.voteUp')}
              className={`${voteButton} ${vote === "up"
                ? "bg-accent text-accent-ink"
                : "text-ink-2 hover:bg-page hover:text-ink"
                }`}
            >
              {/* A vote given shows in the shape too, not in colour alone. */}
              <ThumbsUp size={18} strokeWidth={1.75} fill={vote === "up" ? "currentColor" : "none"} fillOpacity={0.35} />
            </button>

            <span className={`w-6 text-center text-sm font-semibold tabular-nums sm:w-7 ${vote === "up" ? "text-accent" : score > 0 ? "text-ink" : score < 0 ? "text-ink-2" : "text-ink-3"}`}>
              {score}
            </span>

            <button
              onClick={(event) => {
                event.stopPropagation();
                onVote(track.id, "down");
              }}
              aria-pressed={vote === "down"}
              aria-label={t('track.voteDown')}
              title={t('track.voteDown')}
              className={`${voteButton} ${vote === "down"
                ? "bg-ink text-page"
                : "text-ink-2 hover:bg-page hover:text-ink"
                }`}
            >
              <ThumbsDown size={18} strokeWidth={1.75} fill={vote === "down" ? "currentColor" : "none"} fillOpacity={0.35} />
            </button>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="mt-3 space-y-3 border-t border-line pt-3 text-ink">

          {/* Inline Suggestions Accordion (Moved to Top) */}
          {isActiveSuggestion && (
            <div className="animate-fadeIn border-b border-line pb-3">
              <h4 className="mb-2 px-1 text-[13px] font-medium text-ink-2">
                {t('suggestions.title', 'Similar Songs')}
              </h4>

              {isFetchingSuggestions ? (
                <div className="flex flex-col items-center justify-center gap-3 py-8 text-ink-2">
                  <Loader2 className="animate-spin text-ink-2" size={22} />
                  <p className="text-xs font-medium">{t('suggestions.loading', 'Finding similar videos...')}</p>
                </div>
              ) : suggestions && suggestions.length > 0 ? (
                <Suggestions suggestions={suggestions} onAdd={onAddSuggestion || onAdd} onPreview={onPreview} queueVideoIds={queueVideoIds} />
              ) : (
                <div className="py-4 text-center text-sm text-ink-2">
                  {t('suggestions.empty', 'No suggestions found.')}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2">
            {onAdd && !queueVideoIds?.has(track.videoId) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAdd(track.videoId);
                }}
                className={`${actionButton} cv-btn-accent font-semibold`}
              >
                {t('track.add')}
              </button>
            )}
            {onRecommend && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRecommend(track);
                }}
                className={`${actionButton} cv-btn-quiet`}
              >
                {t('track.recommend', 'Get Suggestions')}
              </button>
            )}
            {onPreview && !isActive && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onPreview(track);
                }}
                className={`${actionButton} cv-btn-quiet`}
              >
                <Headphones size={18} className="text-ink-2" />
                {t('track.preview')}
              </button>
            )}
            {onDelete && (
              showDeleteConfirm ? (
                <div className="flex animate-fadeIn gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDeleteConfirm(false);
                    }}
                    className="cv-btn cv-btn-quiet h-11 flex-1"
                  >
                    {t('track.cancel')}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(track.id);
                    }}
                    className="cv-btn h-11 flex-1 border border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                  >
                    {t('track.confirmDelete')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDeleteConfirm(true);
                  }}
                  className={`${actionButton} text-red-400 hover:bg-red-500/10`}
                >
                  <Trash2 size={18} />
                  {t('track.delete')}
                </button>
              )
            )}
          </div>
          {!isApple && (
            <a
              href={buildWatchUrl(track.videoId)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="inline-flex items-center gap-2 px-1 text-sm text-ink-2 underline decoration-ink-3 underline-offset-4 transition-colors duration-150 hover:text-ink"
            >
              {t('track.watch')}
            </a>
          )}
        </div>
      )}

    </div >
  );
}

Track.propTypes = {
  track: PropTypes.object.isRequired,
  isActive: PropTypes.bool.isRequired,
  isExpanded: PropTypes.bool.isRequired,
  vote: PropTypes.string,
  onVote: PropTypes.func.isRequired,
  onToggleExpand: PropTypes.func.isRequired,
  onPreview: PropTypes.func,
  readOnly: PropTypes.bool,
  onDelete: PropTypes.func,
  onAdd: PropTypes.func,
  onAddSuggestion: PropTypes.func,
  onRecommend: PropTypes.func,
  activeSuggestionId: PropTypes.string,
  suggestions: PropTypes.array,
  isFetchingSuggestions: PropTypes.bool,
  queueVideoIds: PropTypes.object, // Set
};
