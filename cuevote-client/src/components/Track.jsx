// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { ThumbsUp, ThumbsDown, Headphones, Trash2, Loader2, UserRound } from "lucide-react";
import { Language } from '../contexts/LanguageContext';
import { Consent } from '../contexts/ConsentContext';
import { Suggestions } from "./Suggestions";
import { Skeleton } from "./Skeleton";
import { CoverImage } from "./CoverImage";
import { suggesterLabel } from "../utils/participation";
import { formatCount } from "../utils/numbers";
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


  const { t, language } = Language.useLanguage();
  const { hasConsent, hasAppleConsent } = Consent.useConsent();

  // Apple Music artwork may appear with playback or playlists (current track,
  // queue, history, library), never on its own like in the lobby. Apple items
  // have no YouTube thumbnail or watch page to fall back to.
  const isApple = isAppleKey(track.videoId);
  const thumbnailSrc = track.thumbnail ?? (isApple ? null : buildThumbnailUrl(track.videoId));

  const score = track.score || 0;
  // The count ticks when it changes, not when the row first shows: up from
  // below when it grew, down from above when it shrank.
  const [shownScore, setShownScore] = useState(score);
  const [tick, setTick] = useState({ count: 0, grew: true });
  if (score !== shownScore) {
    setShownScore(score);
    setTick({ count: tick.count + 1, grew: score > shownScore });
  }

  // The panel stays in the page while the row closes, so that closing is as
  // smooth as opening. Out of reach (inert) from the moment it starts to close.
  const [panelShown, setPanelShown] = useState(isExpanded);
  if (isExpanded && !panelShown) setPanelShown(true);
  useEffect(() => {
    if (isExpanded) return undefined;
    const timer = setTimeout(() => setPanelShown(false), 220);
    return () => clearTimeout(timer);
  }, [isExpanded]);
  const suggester = suggesterLabel(track, t);
  // Next to the person icon a guest's tag says enough.
  const suggesterShort = track.suggestedByIsGuest && track.suggestedByGuestTag ? track.suggestedByGuestTag : suggester;
  const showVotes = !readOnly && votesEnabled && !isActive;
  // A fingertip needs 44 px; a mouse pointer gets by with less. The hand is
  // always drawn as a line; a vote given puts a disc behind it, and the disc
  // is smaller than the area that takes the tap.
  const voteButton = "group/vote flex h-11 w-11 items-center justify-center rounded-full sm:h-9 sm:w-9";
  const voteDisc = "flex h-8 w-8 items-center justify-center rounded-full transition-[background-color,color,box-shadow,transform] duration-150 ease-cv group-active/vote:scale-90";
  const voteGiven = "scale-110 text-white shadow-[0_4px_10px_-2px_rgb(0_0_0/0.55)]";
  const actionButton = "cv-btn h-11 w-full";

  return (
    <div
      onClick={() => onToggleExpand(track.id)}
      className={`cursor-pointer overflow-hidden rounded-xl px-3 py-2 transition-colors duration-150 ${isExpanded
        ? "bg-raised"
        : isActive
          ? "bg-card"
          : "bg-card hover:bg-raised"
        } ${isActive
          // What plays now: a green outline with a little light around it.
          ? "ring-1 ring-inset ring-green-500 shadow-[0_0_14px_rgb(34_197_94/0.3)]"
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
            <span dir="auto" className={`cv-bidi block text-[15px] font-medium leading-5 text-ink ${isExpanded ? "break-words" : "truncate"}`}>
              {track.title}
            </span>
          ) : (
            // Title cleared after YouTube's 28-day metadata limit — re-fetched
            // on join. Skeleton bridges the brief gap instead of showing "null".
            <Skeleton className="h-4 w-40 max-w-full" />
          )}
          {track.artist ? (
            <span className={`mt-0.5 flex min-w-0 items-center gap-x-2 text-[13px] leading-5 text-ink-2 ${isExpanded ? "flex-wrap" : ""}`}>
              <span dir="auto" className={`cv-bidi min-w-0 ${isExpanded ? "break-words" : "truncate"}`}>{track.artist}</span>
              {/* Phones: who suggested it sits here, where a row with votes
                  has no room for it on the right. When both are long, the
                  artist keeps its room and this name gives way first. */}
              {suggester && showVotes && (
                <span className="flex min-w-[3rem] max-w-[6.5rem] shrink-[100] items-center gap-1 text-xs text-ink-3 sm:hidden">
                  <UserRound size={12} className="flex-none" aria-hidden="true" />
                  <span dir="auto" className="cv-bidi truncate">{suggesterShort}</span>
                </span>
              )}
            </span>
          ) : isActive ? null : (
            <Skeleton className="mt-1.5 h-3.5 w-24 max-w-full" />
          )}
        </span>

        {suggester && (
          <span dir="auto" className={`cv-bidi max-w-[6.5rem] flex-shrink-0 truncate text-xs text-ink-3 ${showVotes ? "max-sm:hidden" : ""}`}>
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
              className={voteButton}
            >
              <span className={`${voteDisc} ${vote === "up"
                ? `${voteGiven} bg-gradient-to-br from-orange-500 to-orange-600`
                : "text-orange-400 group-hover/vote:bg-accent/15"
                }`}>
                <ThumbsUp size={20} />
              </span>
            </button>

            {/* As wide as its digits: a big count takes room from the title,
                never from the thumb next to it. */}
            <span className={`min-w-6 flex-none whitespace-nowrap text-center text-sm font-bold tabular-nums sm:min-w-7 ${score > 0 ? "text-orange-400" : score < 0 ? "text-ink-2" : "text-ink-3"}`}>
              <span key={tick.count} className={tick.count === 0 ? undefined : tick.grew ? "cv-tick" : "cv-tick cv-tick-down"}>{formatCount(score, language)}</span>
            </span>

            <button
              onClick={(event) => {
                event.stopPropagation();
                onVote(track.id, "down");
              }}
              aria-pressed={vote === "down"}
              aria-label={t('track.voteDown')}
              title={t('track.voteDown')}
              className={voteButton}
            >
              <span className={`${voteDisc} ${vote === "down"
                ? `${voteGiven} bg-gradient-to-br from-neutral-600 to-neutral-800`
                : "text-ink-3 group-hover/vote:bg-ink/10 group-hover/vote:text-ink-2"
                }`}>
                <ThumbsDown size={20} />
              </span>
            </button>
          </div>
        )}
      </div>

      {/* What can be done with the track opens under it: the row grows to
          its panel's height (an accordion) instead of snapping open. */}
      <div className={`grid transition-[grid-template-rows] duration-200 ease-cv motion-reduce:transition-none ${isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
      <div className="min-h-0 overflow-hidden" inert={!isExpanded}>
      {panelShown && (
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
      </div>
      </div>

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
