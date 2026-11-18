// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useState, useEffect, useRef, useLayoutEffect } from "react";
import PropTypes from "prop-types";
import { Pause, Play, Volume2, VolumeX, Maximize2, Minimize2, ChevronUp, ChevronDown, ListMusic } from "lucide-react";
import { deviceDetection } from '../utils/deviceDetection';
import { Language } from '../contexts/LanguageContext';

export function PlaybackControls({
  isPlaying,
  onPlayPause,
  progress,
  currentTrack,
  activeChannel,
  isMuted,
  onMuteToggle,
  volume,
  onVolumeChange,
  isCinemaMode = false,
  onToggleCinemaMode,
  onVisibilityChange,
  isOwner = false,
  onSeek,
  onHeightChange,
  canShowControls = true,
  isQueueMinimized = true,
  onQueueToggle,
  upcomingCount = 0,
  // On phones the bar is part of the room's column, above the suggest field,
  // instead of floating over the bottom edge.
  docked = false,
  // What the bar offers for loudness: 'full' is the mute button (and the slider
  // on a computer); 'none' where nothing on this device changes what is heard.
  volumeControl = 'full',
  // The mute button shows a muted player in the accent colour: where muting is
  // the only loudness control, a silent room must not look like a quiet icon.
  mutedAccent = false,
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [tempVisible, setTempVisible] = useState(false);
  const hideTimeoutRef = useRef(null);
  const progressBarRef = useRef(null);
  const overlayRef = useRef(null);
  const isHoveredRef = useRef(false);
  const { t } = Language.useLanguage();

  // Function to show controls temporarily (e.g. on video start or mouse leave)
  const activateTemporaryVisibility = () => {
    if (isHoveredRef.current) return; // Don't hide if hovered (checked via Ref for sync access)
    setTempVisible(true);
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => {
      setTempVisible(false);
    }, 3000);
  };

  // Show temporarily when track changes
  useEffect(() => {
    if (currentTrack) {
      activateTemporaryVisibility();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id]);

  // Clean up timeout
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  const handleMouseEnter = () => {
    if (deviceDetection.isMobile()) return; // Disable hover logic on mobile
    setIsHovered(true);
    isHoveredRef.current = true;
    setTempVisible(true); // Keep it visible without timeout while hovered
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
  };

  const handleMouseLeave = () => {
    if (deviceDetection.isMobile()) return; // Disable hover logic on mobile
    setIsHovered(false);
    isHoveredRef.current = false;
    activateTemporaryVisibility(); // Start timeout once mouse leaves
  };

  const handleTouchInteraction = () => {
    // On mobile, explicit touch resets the timer to keep controls visible
    activateTemporaryVisibility();
  };



  // Calculate visibility before using it in effects
  const shouldShow = (!isCinemaMode || isHovered || tempVisible) && canShowControls;

  // Notify parent of visibility changes
  useEffect(() => {
    if (onVisibilityChange) {
      onVisibilityChange(shouldShow);
    }
  }, [shouldShow, onVisibilityChange]);

  // Handle window blur (e.g. clicking into iframe) as a "leave" event
  useEffect(() => {
    const handleWindowBlur = () => {
      if (isHovered) {
        handleMouseLeave();
      }
    };
    window.addEventListener("blur", handleWindowBlur);
    return () => window.removeEventListener("blur", handleWindowBlur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHovered]);

  const percentageAt = (e) => {
    const rect = progressBarRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
  };

  // Where a drag along the bar stands. Dragging only moves the bar; the seek
  // goes out once, with the click that ends it. Seeking on every mouse move
  // sent dozens of seeks a second, up to the server's rate limit, and made
  // the Apple player seek on each (Nov. 2026).
  const [dragPercent, setDragPercent] = useState(null);

  const handleSeekClick = (e) => {
    setDragPercent(null);
    if (!isOwner || !onSeek) return;
    onSeek(percentageAt(e));
  };

  const handleMouseMove = (e) => {
    if (e.buttons === 1) setDragPercent(percentageAt(e)); // left button held
    else if (dragPercent !== null) setDragPercent(null);
  };


  const footerRef = useRef(null);

  // Measure Footer Height for App Layout
  useLayoutEffect(() => {
    if (!footerRef.current) return;

    const updateHeight = () => {
      if (footerRef.current && onHeightChange) {
        onHeightChange(footerRef.current.offsetHeight);
      }
    };

    // Initial measure
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(footerRef.current);

    return () => observer.disconnect();
  }, [onHeightChange, shouldShow]); // Re-run if visibility changes to ensure 0 or full height is reported

  return (
    <>


      {isCinemaMode && (
        <div
          ref={overlayRef}
          className="fixed bottom-0 left-0 w-full h-2 z-[60] bg-transparent"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onTouchStart={handleTouchInteraction}
        />
      )}
      <footer
        ref={footerRef}
        className={`w-full bg-page/95 backdrop-blur-md border-t border-line px-4 pt-3 flex flex-col gap-3 select-none md:px-6 ${docked
          ? 'relative flex-none pb-3'
          : `fixed bottom-0 left-0 pb-[calc(0.75rem+env(safe-area-inset-bottom))] z-[70] transition-transform duration-300 ease-cv ${shouldShow ? 'translate-y-0' : 'translate-y-full'}`}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchInteraction}
      >
        {/* Progress Bar */}
        <div
          ref={progressBarRef}
          className={`w-full bg-raised rounded-full h-1.5 overflow-hidden relative ${isOwner ? 'cursor-pointer group' : ''}`}
          onClick={handleSeekClick}
          onMouseMove={isOwner ? handleMouseMove : undefined}
          onMouseLeave={() => setDragPercent(null)}
        >
          {/* Scaled, not resized: a width that changes every second would
              lay the bar out again each time. */}
          <div
            className={`h-1.5 w-full origin-left bg-accent ${dragPercent === null ? 'transition-transform duration-300 ease-linear' : ''}`}
            style={{ transform: `scaleX(${Math.max(0, Math.min(100, dragPercent ?? progress)) / 100})` }}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <button
              onClick={(event) => {
                event.stopPropagation();
                onPlayPause();
              }}
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-[background-color,transform,opacity] duration-150 ease-cv hover:bg-[#fb8b3c] active:scale-95 disabled:opacity-50"
              disabled={!currentTrack}
              aria-label={isPlaying ? t('playlist.pause') : t('playlist.play')}
              title={isPlaying ? t('playlist.pause') : t('playlist.play')}
            >
              {isPlaying ? <Pause size={20} fill="currentColor" strokeWidth={0} /> : <Play size={20} fill="currentColor" strokeWidth={0} className="translate-x-px" />}
            </button>

            <div className="flex-1 min-w-0">
              {/* The title leads. That it is playing shows in the bar itself:
                  the pause button and the line that fills. */}
              <h3 dir="auto" className="cv-bidi truncate text-[15px] font-medium leading-5 text-ink" title={currentTrack?.title || undefined}>
                {currentTrack
                  ? (currentTrack.title || t('playlist.nowPlaying'))
                  : t('playlist.queueEmpty')}
              </h3>
              <p dir="auto" className="cv-bidi truncate text-[13px] leading-5 text-ink-2">
                {currentTrack
                  ? [currentTrack.artist, activeChannel].filter(Boolean).join(' · ')
                  : t('playlist.addVideos')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 text-ink-2 flex-shrink-0">
            {volumeControl === 'full' && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onMuteToggle();
                }}
                className={`cv-hit flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-150 hover:bg-raised hover:text-ink ${mutedAccent && isMuted ? 'text-accent' : ''}`}
                disabled={!currentTrack}
                aria-label={isMuted ? t('playlist.unmute') : t('playlist.mute')}
                title={isMuted ? t('playlist.unmute') : t('playlist.mute')}
                aria-pressed={isMuted}
              >
                {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
            )}
            {volumeControl === 'full' && !deviceDetection.isMobile() && (
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={volume}
                onChange={onVolumeChange}
                aria-label={t('playlist.volume')}
                className={`mr-1 w-24 accent-[rgb(var(--cv-accent))] ${isMuted ? "opacity-50" : ""}`}
                onClick={(event) => event.stopPropagation()}
                disabled={!currentTrack}
              />
            )}
            {!isCinemaMode && onQueueToggle && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onQueueToggle();
                }}
                className={`flex h-9 items-center gap-1.5 rounded-lg px-2 transition-colors duration-150 hover:bg-raised hover:text-ink ${isQueueMinimized ? '' : 'bg-raised text-ink'}`}
                title={t('playlist.upNext')}
                aria-label={t('playlist.upNext')}
                aria-expanded={!isQueueMinimized}
              >
                <ListMusic size={18} />
                {upcomingCount > 0 && (
                  <span className="text-sm font-semibold tabular-nums text-ink">
                    {upcomingCount}
                  </span>
                )}
                {isQueueMinimized ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            )}
            {(!deviceDetection.isMobile() || deviceDetection.isTablet()) && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleCinemaMode();
                }}
                className="cv-hit flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-150 hover:bg-raised hover:text-ink"
                aria-label={isCinemaMode ? t('playlist.exitCinemaMode') : t('playlist.cinemaMode')}
                title={isCinemaMode ? t('playlist.exitCinemaMode') : t('playlist.cinemaMode')}
              >
                {isCinemaMode ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              </button>
            )}
          </div>
        </div>
      </footer>
    </>
  );
}

PlaybackControls.propTypes = {
  isPlaying: PropTypes.bool.isRequired,
  onPlayPause: PropTypes.func.isRequired,
  progress: PropTypes.number.isRequired,
  currentTrack: PropTypes.object,
  activeChannel: PropTypes.string.isRequired,
  isMuted: PropTypes.bool.isRequired,
  onMuteToggle: PropTypes.func.isRequired,
  volume: PropTypes.number.isRequired,
  onVolumeChange: PropTypes.func.isRequired,
  isCinemaMode: PropTypes.bool,
  onToggleCinemaMode: PropTypes.func,
  onVisibilityChange: PropTypes.func,
  isOwner: PropTypes.bool,
  onSeek: PropTypes.func,
  onHeightChange: PropTypes.func,
  isQueueMinimized: PropTypes.bool,
  onQueueToggle: PropTypes.func,
  upcomingCount: PropTypes.number,
  docked: PropTypes.bool,
  volumeControl: PropTypes.oneOf(['full', 'none']),
  mutedAccent: PropTypes.bool,
};
