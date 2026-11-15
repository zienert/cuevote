// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import { GoogleAuthButton } from "./GoogleAuthButton";
import { GoogleGIcon } from "./GoogleGIcon";
import { LogOut, Settings, List, Send, QrCode, Library, Copy, Check, Scale, ChevronLeft } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Language } from '../contexts/LanguageContext';
import { deviceDetection } from '../utils/deviceDetection';
import { dangerousHtml } from '../utils/sanitizeHtml';
import { YouTubeBrandSubtitle } from './YouTubeBrandSubtitle';
import { SegmentedControl } from './SegmentedControl';
import { displayName, isSignedIn } from '../utils/participation';


export function Header({
  onGoHome,
  onShowSuggest,
  user,
  onLoginSuccess,
  onLogout,
  isOwner,
  showQRCode,
  onShowQRCode,
  onDeleteAccount,
  showSettings,
  onToggleSettings,
  onCloseSettings,
  mode,
  onPlaylist,
  onSuggest,
  onShare,
  onLibrary,
  onClosePlaylist,
  showSuggest,
  suggestionsEnabled,
  ownerBypass,
  playlistViewMode,
  onFullscreenOverlay,
  // An Apple Music room plays nothing from YouTube, so it carries no YouTube attribution.
  showYouTubeAttribution = true,
  // Phones: the channel's name, and whether this device has a player view
  // besides the playlist and the library.
  channelName,
  hasPlayerView = false,
}) {
  const headerRef = React.useRef(null);
  const [showExitConfirm, setShowExitConfirm] = React.useState(false);
  const [showProfileModal, setShowProfileModal] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false); // Account Delete
  // const [showDeleteChannelConfirm, setShowDeleteChannelConfirm] = React.useState(false); // Moved to SettingsView
  // const [deleteChannelText, setDeleteChannelText] = React.useState(""); // Moved to SettingsView

  const [exitConfirmIndex, setExitConfirmIndex] = React.useState(0); // 0 = Cancel, 1 = Leave
  // const [showQRCode, setShowQRCode] = React.useState(false); // Removed local state
  const [copied, setCopied] = React.useState(false);

  useEffect(() => {
    onFullscreenOverlay?.(showExitConfirm || showProfileModal);
  }, [showExitConfirm, showProfileModal, onFullscreenOverlay]);
  const pillsRef = useRef(null);
  const dragRef = useRef({ startX: 0, startScrollLeft: 0, isDragging: false });
  const [isPillDragging, setIsPillDragging] = React.useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = React.useState("");
  const { t } = Language.useLanguage();
  const isTouchDevice = deviceDetection.isMobile() || deviceDetection.isTablet();

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!headerRef.current) return;
      if (headerRef.current.contains(event.target)) return;
      if (event.target.closest(".keep-open")) return;
      // Do not close settings if exit confirm is open to avoid conflict
      if (showExitConfirm) return;
      // onShowSuggest(false); // User requested to keep suggest bar open on back key press (click outside)
      // setShowSettings(false); // Handled by onClose prop if we passed it, but for now we rely on explicit toggle or outside click logic in App? 
      // Actually App handles "click outside"? No, Header handles click outside for its own menus.
      // But SettingsView is now separate. Header doesn't control it.
      // So removing setShowSettings(false) here is correct.
      // Close QR code if clicked outside (unless it's the QR code modal content)
      if (!event.target.closest(".qr-code-modal")) {
        onShowQRCode(false);
        setCopied(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onShowSuggest, showExitConfirm, onShowQRCode]); // Added onShowQRCode to dependency array

  // Handle Keyboard Navigation for Exit Confirmation
  useEffect(() => {
    if (!showExitConfirm) return;

    const handleKeyDown = (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setExitConfirmIndex(1); // Move to Leave
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setExitConfirmIndex(0); // Move to Cancel
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (exitConfirmIndex === 1) {
          onGoHome();
          setShowExitConfirm(false);
          onShowSuggest(false);
        } else {
          setShowExitConfirm(false);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowExitConfirm(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showExitConfirm, exitConfirmIndex, onGoHome, onShowSuggest]);

  // Handle Escape Key for other modals
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        // if (showSettings) setShowSettings(false); // Handled by App
        if (showProfileModal) setShowProfileModal(false);
        if (showDeleteConfirm) setShowDeleteConfirm(false);
        // We can safely call these even if not open, assuming they set boolean state
        onShowSuggest(false);
        onShowQRCode(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [showProfileModal, showDeleteConfirm, onShowSuggest, onShowQRCode]);

  useLayoutEffect(() => {
    const el = pillsRef.current;
    if (el) el.scrollLeft = 0;
  }, [mode, isOwner]);

  useEffect(() => {
    const el = pillsRef.current;
    if (!el) return;
    const DRAG_THRESHOLD = 4;

    const onMouseMove = (e) => {
      const { startX, startScrollLeft, isDragging } = dragRef.current;
      const dx = e.clientX - startX;
      if (!isDragging && Math.abs(dx) > DRAG_THRESHOLD) {
        dragRef.current.isDragging = true;
        setIsPillDragging(true);
      }
      if (dragRef.current.isDragging) {
        e.preventDefault();
        el.scrollLeft = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, startScrollLeft - dx));
      }
    };

    const onMouseUp = () => {
      if (dragRef.current.isDragging) setIsPillDragging(false);
      dragRef.current = { startX: 0, startScrollLeft: 0, isDragging: false };
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    const onMouseDown = (e) => {
      dragRef.current = {
        startX: e.clientX,
        startScrollLeft: el.scrollLeft,
        isDragging: false,
      };
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    };

    el.addEventListener("mousedown", onMouseDown);
    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const effectiveIsOwner = isOwner && ownerBypass;
  const suggestDisabled = !suggestionsEnabled && !effectiveIsOwner;

  // The room's views and actions: quiet buttons, the open one a step lighter.
  // Suggesting is the one thing everyone comes here to do, so it alone
  // carries the accent.
  const pillClass = (active, accent = false) =>
    `keep-open flex h-8 items-center gap-2 px-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-[background-color,color,transform] duration-150 ease-cv active:scale-[0.97] flex-shrink-0 ${
      active
        ? (accent ? "bg-accent/15 text-accent" : "bg-raised text-ink")
        : (accent ? "text-accent hover:bg-accent/10" : "text-ink-2 hover:bg-raised hover:text-ink")
    }`;

  const isPlaylistMode = mode === "playlist" || mode === "library";

  const renderPills = ({ includeSuggest = !isTouchDevice } = {}) => {
    if (isPlaylistMode) {
      return (
        <>
          <button onClick={onPlaylist} className={pillClass(mode === "playlist")}>
            <List size={16} /><span>{t('header.playlist')}</span>
          </button>
          <button onClick={onLibrary} className={pillClass(mode === "library")}>
            <Library size={16} /><span>{t('header.library')}</span>
          </button>
          {/* Desktop guests in the playlist view (venue mode, every Apple
              room) suggest from here; touch devices have their own button. */}
          {includeSuggest && (
            <button onClick={onSuggest} disabled={suggestDisabled} className={`${pillClass(showSuggest, true)} ${suggestDisabled ? "opacity-40" : ""}`}>
              <Send size={16} /><span>{t('header.suggest')}</span>
            </button>
          )}
        </>
      );
    }

    return (
      <>
        {!(playlistViewMode && !isOwner) && (
          <button onClick={onPlaylist} className={pillClass(false)}>
            <List size={16} /><span>{t('header.playlist')}</span>
          </button>
        )}
        <button onClick={onShare} className={pillClass(false)}>
          <QrCode size={16} /><span>{t('header.share')}</span>
        </button>
        {isOwner && (
          <button onClick={onToggleSettings} className={pillClass(showSettings)}>
            <Settings size={16} /><span>{t('header.settings')}</span>
          </button>
        )}
        {includeSuggest && (
          <button onClick={onSuggest} disabled={suggestDisabled} className={`${pillClass(showSuggest, true)} ${suggestDisabled ? "opacity-40" : ""}`}>
            <Send size={16} /><span>{t('header.suggest')}</span>
          </button>
        )}
      </>
    );
  };

  const suggestButton = (
    <button onClick={onSuggest} disabled={suggestDisabled} className={`${pillClass(showSuggest, true)} ${suggestDisabled ? "opacity-40" : ""}`}>
      <Send size={16} /><span>{t('header.suggest')}</span>
    </button>
  );

  const wordmark = (
    <h1 className="text-lg font-bold text-accent tracking-tight whitespace-nowrap flex-shrink-0">
      CueVote
    </h1>
  );

  const askToLeave = () => {
    setShowExitConfirm(true);
    setExitConfirmIndex(0);
    if (onCloseSettings) onCloseSettings();
  };

  const backButton = (
    <button
      onClick={() => {
        if (isPlaylistMode && onClosePlaylist) {
          onClosePlaylist();
        } else {
          askToLeave();
        }
      }}
      className="cv-hit flex h-8 w-8 items-center justify-center text-ink-2 hover:text-ink transition-colors duration-150 rounded-lg hover:bg-raised flex-shrink-0"
      title={isPlaylistMode && onClosePlaylist ? t('playlist.close') : t('header.leave')}
    >
      <ChevronLeft size={20} />
    </button>
  );

  // Phones switch between the room's views with tabs, so the arrow there only
  // ever leaves the channel.
  const leaveButton = (
    <button
      onClick={askToLeave}
      className="cv-hit flex h-8 w-8 items-center justify-center text-ink-2 hover:text-ink transition-colors duration-150 rounded-lg hover:bg-raised flex-shrink-0"
      title={t('header.leave')}
      aria-label={t('header.leave')}
    >
      <ChevronLeft size={20} />
    </button>
  );

  // The views of the room on a phone: the player where this device has one
  // (three tabs get no icons, they would not fit), the playlist, the library.
  const phoneTabs = [
    ...(hasPlayerView ? [{ value: "default", label: t('header.player') }] : []),
    { value: "playlist", label: t('header.playlist'), icon: hasPlayerView ? undefined : List },
    { value: "library", label: t('header.library'), icon: hasPlayerView ? undefined : Library },
  ];
  const selectPhoneTab = (view) => {
    if (view === "default") onClosePlaylist?.();
    else if (view === "playlist") onPlaylist();
    else onLibrary();
  };
  const phoneIconButton = "keep-open cv-hit flex h-9 w-9 flex-none items-center justify-center rounded-lg transition-[background-color,color,transform] duration-150 ease-cv active:scale-90";

  const userIdentity = isSignedIn(user) ? (
    <button
      onClick={() => setShowProfileModal(true)}
      className="flex-shrink-0 rounded-full transition-transform duration-150 ease-cv active:scale-90"
      title={t('header.profileSettings')}
    >
      {user.picture ? (
        <img src={user.picture} alt={user.name} referrerPolicy="no-referrer" className="w-7 h-7 rounded-full border border-line" />
      ) : (
        <div className="w-7 h-7 rounded-full bg-raised flex items-center justify-center text-xs font-semibold text-ink-2 border border-line">
          {displayName(user, t).charAt(0)}
        </div>
      )}
    </button>
  ) : (
    <GoogleAuthButton
      onLoginSuccess={onLoginSuccess}
      render={(performLogin, disabled) => (
        // Without the cookie consent performLogin asks for it.
        <button
          onClick={() => performLogin()}
          className={`cv-hit flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full border border-line bg-raised transition-[opacity,transform] duration-150 ease-cv ${disabled ? 'opacity-50' : 'active:scale-90'}`}
          title={disabled ? t('header.acceptCookies') : t('header.signIn')}
        >
          <GoogleGIcon className="w-4 h-4" />
        </button>
      )}
    />
  );

  return (
    <header
      ref={headerRef}
      className="px-2 py-1.5 md:px-3 md:py-2 w-full safe-pt"
    >
      {/* Desktop / tablet-landscape (≥ md): single-row layout */}
      <div className="hidden md:flex items-center w-full gap-2">
        {wordmark}
        {backButton}
        {userIdentity}

        <div className="h-5 w-px bg-line flex-shrink-0" />

        <div
          ref={pillsRef}
          className={`flex-1 overflow-x-auto no-scrollbar overscroll-x-contain touch-pan-x touch-pan-y flex items-center gap-1.5 min-w-0 select-none ${isPillDragging ? "cursor-grabbing" : "cursor-grab"}`}
        >
          {renderPills()}
        </div>
        {isTouchDevice && (
          <div className="flex-shrink-0">
            {suggestButton}
          </div>
        )}
        {showYouTubeAttribution && <YouTubeBrandSubtitle className="flex-shrink-0 whitespace-nowrap" />}
      </div>

      {/* Phones (< md): one slim row (leave, wordmark, the channel's name over
          its music source, share, settings, account) and the room's views as
          tabs below it. Suggesting lives at the bottom of the screen there,
          see RoomBody. */}
      <div className="md:hidden">
        <div className="flex items-center gap-1 min-w-0">
          {leaveButton}
          {wordmark}
          <div className="ml-2 min-w-0 flex-1 leading-tight">
            <p id="room-channel-name" className="truncate text-sm font-semibold text-ink">{channelName}</p>
            {showYouTubeAttribution
              ? <YouTubeBrandSubtitle className="max-w-full truncate align-top" />
              : <span className="block truncate text-[11px] font-semibold leading-4 text-orange-400">Apple Music</span>}
          </div>
          <button
            onClick={onShare}
            title={t('header.share')}
            aria-label={t('header.share')}
            className={`${phoneIconButton} text-ink-2 hover:bg-raised hover:text-ink`}
          >
            <QrCode size={18} />
          </button>
          {isOwner && (
            <button
              onClick={onToggleSettings}
              title={t('header.settings')}
              aria-label={t('header.settings')}
              className={`${phoneIconButton} ${showSettings ? "bg-raised text-ink" : "text-ink-2 hover:bg-raised hover:text-ink"}`}
            >
              <Settings size={18} />
            </button>
          )}
          {userIdentity}
        </div>
        <div className="mt-2 mb-0.5">
          <SegmentedControl
            labelledBy="room-channel-name"
            options={phoneTabs}
            value={mode || "default"}
            onChange={selectPhoneTab}
            size={phoneTabs.length > 2 ? "sm" : "md"}
          />
        </div>
      </div>

      {
        showExitConfirm && createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-card border border-line rounded-2xl w-full max-w-sm p-6 shadow-2xl scale-100 animate-in zoom-in-95 duration-200 text-center">
              <h3 className="text-xl font-semibold text-ink mb-2">{t('header.leaveChannel')}</h3>
              <p className="text-ink-2 mb-6">{t('header.leaveChannelConfirm')}</p>

              <div className="flex gap-3 justify-center">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowExitConfirm(false);
                  }}
                  className={`cv-btn h-11 flex-1 border border-line bg-raised ${exitConfirmIndex === 0
                    ? "text-ink ring-2 ring-accent/60"
                    : "text-ink-2"
                    }`}
                  onMouseEnter={() => setExitConfirmIndex(0)}
                >
                  {t('lobby.cancel')}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (import.meta.env.DEV) {
                      console.log("[Header] Leave confirmed, navigating home...");
                    }
                    onGoHome();
                    setShowExitConfirm(false);
                    onShowSuggest(false);
                  }}
                  className={`cv-btn h-11 flex-1 font-semibold ${exitConfirmIndex === 1
                    ? "bg-accent text-accent-ink"
                    : "border border-line bg-raised text-ink"
                    }`}
                  onMouseEnter={() => setExitConfirmIndex(1)}
                >
                  {t('header.leave')}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      }
      {/* QR Code Modal */}
      {
        showQRCode && createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200"
            onClick={() => onShowQRCode(false)}
          >
            <div
              className="qr-code-modal bg-card border border-line rounded-2xl w-full max-w-sm p-6 shadow-2xl scale-100 animate-in zoom-in-95 duration-200 text-center flex flex-col items-center"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-semibold text-ink mb-4">{t('header.share')}</h3>
              {/* Dark on white, with a quiet zone: a code drawn light on dark is
                  one that some phone cameras do not read. */}
              <div className="mb-4 rounded-xl bg-white p-4">
                <QRCodeSVG
                  value={window.location.href}
                  size={200}
                  level={"H"}
                  includeMargin={false}
                  fgColor={"#0a0a09"}
                  bgColor={"#ffffff"}
                />
              </div>

              <div className="flex items-center gap-2 mb-6 bg-page p-1.5 pl-3 rounded-xl w-full max-w-[280px] border border-line">
                <p className="text-ink-2 text-sm overflow-x-auto whitespace-nowrap flex-1 no-scrollbar">{window.location.href}</p>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href)
                      .then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      })
                      .catch(() => { /* Clipboard denied or unavailable */ });
                  }}
                  className={`cv-hit flex h-8 w-8 items-center justify-center rounded-lg transition-[background-color,color,transform] duration-150 ease-cv active:scale-90 ${copied
                    ? "bg-accent/15 text-accent"
                    : "bg-raised text-ink-2 hover:text-ink"
                    }`}
                  title={t('header.copyUrl')}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>



              <button
                onClick={() => onShowQRCode(false)}
                className="cv-btn cv-btn-quiet px-6"
              >
                {t('header.close')}
              </button>
            </div>
          </div>,
          document.body
        )
      }
      {
        showProfileModal && createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200"
            onClick={() => setShowProfileModal(false)}
          >
            <div
              className="bg-card border border-line rounded-2xl w-full max-w-sm p-6 shadow-2xl scale-100 animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >

              <div className="flex flex-col items-center mb-6">
                {user?.picture ? (
                  <img src={user.picture} alt={user.name} referrerPolicy="no-referrer" className="w-20 h-20 rounded-full border border-line mb-4" />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-raised flex items-center justify-center text-3xl font-semibold text-ink-2 mb-4 border border-line">
                    {displayName(user, t).charAt(0)}
                  </div>
                )}
                <h3 className="text-xl font-semibold text-ink">{displayName(user, t)}</h3>
                <p className="text-sm text-ink-2">{user?.email}</p>
              </div>

              {!showDeleteConfirm ? (
                <div className="space-y-3">
                  <button
                    onClick={() => {
                      onLogout();
                      setShowProfileModal(false);
                    }}
                    className="cv-btn cv-btn-quiet h-11 w-full"
                  >
                    <LogOut size={18} /> {t('lobby.signOut')}
                  </button>

                  <div className="pt-4 border-t border-line mt-4 space-y-3">
                    <a
                      href="/legal"
                      className="cv-btn cv-btn-quiet h-11 w-full text-ink-2 hover:text-ink"
                    >
                      <Scale size={18} /> {t('header.legal')}
                    </a>

                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-red-900/30 text-red-500 hover:bg-red-950/30 hover:border-red-900/50 transition-colors text-sm font-medium"
                    >
                      {t('lobby.deleteAccount')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center animate-in fade-in slide-in-from-bottom-2">
                  <h4 className="text-lg font-bold text-red-500 mb-2">{t('lobby.deleteAccountConfirm')}</h4>
                  <p className="text-sm text-ink-2 mb-4 leading-relaxed" dangerouslySetInnerHTML={dangerousHtml(t('lobby.deleteAccountWarning'))} />

                  <div className="mb-6">
                    <label className="block text-xs text-ink-2 mb-2 font-medium">
                      {t('lobby.deleteAccountType')} <span className="text-ink font-semibold select-none">{t('lobby.deleteAccountPhrase')}</span> {t('lobby.deleteAccountToConfirm')}
                    </label>
                    <input
                      type="text"
                      value={deleteConfirmationText}
                      onChange={(e) => setDeleteConfirmationText(e.target.value)}
                      className="w-full bg-page border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-red-500/50 transition-colors duration-150 placeholder:text-ink-3"
                      placeholder={t('header.deleteChannelType')}
                      autoFocus
                    />
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setShowDeleteConfirm(false);
                        setDeleteConfirmationText("");
                      }}
                      className="cv-btn cv-btn-quiet flex-1"
                    >
                      {t('lobby.cancel')}
                    </button>
                    <button
                      onClick={() => {
                        if (import.meta.env.DEV) {
                          console.log("Delete button clicked in Header");
                        }
                        onDeleteAccount();
                        setShowProfileModal(false);
                        setShowDeleteConfirm(false);
                        setDeleteConfirmationText("");
                      }}
                      disabled={deleteConfirmationText !== t('lobby.deleteAccountPhrase')}
                      className="flex-1 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold transition-colors shadow-lg shadow-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500 disabled:shadow-none"
                    >
                      {t('lobby.delete')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body
        )
      }
    </header >
  );
}

Header.propTypes = {
  onGoHome: PropTypes.func.isRequired,
  onShowSuggest: PropTypes.func.isRequired,
  user: PropTypes.object,
  onLoginSuccess: PropTypes.func,
  onLogout: PropTypes.func,
  isOwner: PropTypes.bool,
  showQRCode: PropTypes.bool,
  onShowQRCode: PropTypes.func,
  onDeleteAccount: PropTypes.func,
  showSettings: PropTypes.bool,
  onToggleSettings: PropTypes.func,
  onCloseSettings: PropTypes.func,
  mode: PropTypes.string,
  onPlaylist: PropTypes.func,
  onSuggest: PropTypes.func,
  onShare: PropTypes.func,
  onLibrary: PropTypes.func,
  onClosePlaylist: PropTypes.func,
  showSuggest: PropTypes.bool,
  suggestionsEnabled: PropTypes.bool,
  ownerBypass: PropTypes.bool,
  playlistViewMode: PropTypes.bool,
  showYouTubeAttribution: PropTypes.bool,
  onFullscreenOverlay: PropTypes.func,
  channelName: PropTypes.string,
  hasPlayerView: PropTypes.bool,
};
