// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useState, useEffect, useRef, useLayoutEffect } from "react";
import PropTypes from "prop-types";
import { Pause, Play, Volume2, VolumeX, Maximize2, Minimize2, ChevronUp, ChevronDown, ListMusic } from "lucide-react";
import { deviceDetection } from '../utils/deviceDetection';
import { Language } from '../contexts/LanguageContext';
import { MarqueeText } from './MarqueeText';

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
        className={`fixed bottom-0 left-0 w-full bg-[#050505]/95 backdrop-blur-md border-t border-neutral-900 px-6 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex flex-col gap-2 z-[70] select-none transition-transform duration-500 ease-in-out ${shouldShow ? 'translate-y-0' : 'translate-y-full'}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchInteraction}
      >
        {/* Progress Bar */}
        <div
          ref={progressBarRef}
          className={`w-full bg-neutral-900 rounded-full h-2 overflow-hidden relative ${isOwner ? 'cursor-pointer group' : ''}`}
          onClick={handleSeekClick}
          onMouseMove={isOwner ? handleMouseMove : undefined}
          onMouseLeave={() => setDragPercent(null)}
        >
          <div
            className={`h-2 bg-gradient-to-r from-orange-400 to-orange-600 relative ${dragPercent === null ? 'transition-all' : ''}`}
            style={{ width: `${dragPercent ?? progress}%` }}
          >
            {/* Handle for owners */}
            {isOwner && (
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 shadow-sm transition-opacity" />
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <button
              onClick={(event) => {
                event.stopPropagation();
                onPlayPause();
              }}
              className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white rounded-full p-3 transition-all shadow-lg flex-shrink-0"
              disabled={!currentTrack}
            >
              {isPlaying ? <Pause /> : <Play />}
            </button>

            <div className="flex-1 min-w-0">
              <MarqueeText as="h3" className="text-base font-semibold leading-tight">
                {currentTrack
                  ? `${t('playlist.nowPlaying')}${currentTrack.title ? ` · ${currentTrack.title}` : ''}`
                  : t('playlist.queueEmpty')}
              </MarqueeText>
              <MarqueeText as="p" className="text-sm text-neutral-400">
                {currentTrack
                  ? `${currentTrack.artist ? `${currentTrack.artist} • ` : ''}${activeChannel} ${t('playlist.channelSuffix')}`
                  : t('playlist.addVideos')}
              </MarqueeText>
            </div>
          </div>

          <div className="flex items-center gap-2 text-neutral-400 flex-shrink-0">
            <button
              onClick={(event) => {
                event.stopPropagation();
                onMuteToggle();
              }}
              className="hover:text-orange-400 transition-colors"
              disabled={!currentTrack}
            >
              {isMuted ? <VolumeX /> : <Volume2 />}
            </button>
            {!deviceDetection.isMobile() && (
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={volume}
                onChange={onVolumeChange}
                className={`accent-orange-500 w-24 ${isMuted ? "opacity-50" : ""}`}
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
                className="hover:text-white transition-colors ml-2 flex items-center gap-1.5"
                title={isQueueMinimized ? "Show Queue" : "Hide Queue"}
              >
                <ListMusic size={18} />
                {upcomingCount > 0 && (
                  <span className="bg-orange-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 leading-none">
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
                className="hover:text-white transition-colors ml-2"
                title={isCinemaMode ? "Exit Cinema Mode" : "Cinema Mode"}
              >
                {isCinemaMode ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
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
};
