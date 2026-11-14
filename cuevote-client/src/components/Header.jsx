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

  const pillClass = (active) =>
    `keep-open flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition-all active:scale-95 flex-shrink-0 ${
      active
        ? "bg-orange-500/15 text-orange-500 border border-orange-500/30"
        : "text-orange-500/70 hover:text-orange-400 hover:bg-orange-500/10 border border-transparent"
    }`;

  const isPlaylistMode = mode === "playlist" || mode === "library";

  const renderPills = ({ includeSuggest = !isTouchDevice } = {}) => {
    if (isPlaylistMode) {
      return (
        <>
          <button onClick={onPlaylist} className={pillClass(mode === "playlist")}>
            <List size={15} /><span>{t('header.playlist')}</span>
          </button>
          <button onClick={onLibrary} className={pillClass(mode === "library")}>
            <Library size={15} /><span>{t('header.library')}</span>
          </button>
          {/* Desktop guests in the playlist view (venue mode, every Apple
              room) suggest from here; touch devices have their own button. */}
          {includeSuggest && (
            <button onClick={onSuggest} disabled={suggestDisabled} className={`${pillClass(showSuggest)} ${suggestDisabled ? "opacity-40" : ""}`}>
              <Send size={15} /><span>{t('header.suggest')}</span>
            </button>
          )}
        </>
      );
    }

    return (
      <>
        {!(playlistViewMode && !isOwner) && (
          <button onClick={onPlaylist} className={pillClass(false)}>
            <List size={15} /><span>{t('header.playlist')}</span>
          </button>
        )}
        <button onClick={onShare} className={pillClass(false)}>
          <QrCode size={15} /><span>{t('header.share')}</span>
        </button>
        {isOwner && (
          <button onClick={onToggleSettings} className={pillClass(showSettings)}>
            <Settings size={15} /><span>{t('header.settings')}</span>
          </button>
        )}
        {includeSuggest && (
          <button onClick={onSuggest} disabled={suggestDisabled} className={`${pillClass(showSuggest)} ${suggestDisabled ? "opacity-40" : ""}`}>
            <Send size={15} /><span>{t('header.suggest')}</span>
          </button>
        )}
      </>
    );
  };

  const suggestButton = (
    <button onClick={onSuggest} disabled={suggestDisabled} className={`${pillClass(showSuggest)} ${suggestDisabled ? "opacity-40" : ""}`}>
      <Send size={15} /><span>{t('header.suggest')}</span>
    </button>
  );

  // Tall variant of the Suggest button — anchors the right edge of the
  // mobile two-row header, spanning both rows via a CSS-grid row-span.
  const suggestButtonTall = (
    <button
      onClick={onSuggest}
      disabled={suggestDisabled}
      className={`keep-open flex flex-col items-center justify-center gap-1 px-4 rounded-2xl font-semibold whitespace-nowrap transition-all active:scale-95 h-full border ${
        showSuggest
          ? "bg-orange-500 text-white border-orange-500 shadow-lg shadow-orange-500/30"
          : "bg-orange-500/15 text-orange-500 border-orange-500/30 hover:bg-orange-500/25"
      } ${suggestDisabled ? "opacity-40" : ""}`}
      aria-label={t('header.suggest')}
    >
      <Send size={20} />
      <span className="text-[11px] leading-none">{t('header.suggest')}</span>
    </button>
  );

  const wordmark = (
    <h1 className="text-lg font-bold text-orange-500 tracking-tight whitespace-nowrap flex-shrink-0">
      CueVote
    </h1>
  );

  const backButton = (
    <button
      onClick={() => {
        if (isPlaylistMode && onClosePlaylist) {
          onClosePlaylist();
        } else {
          setShowExitConfirm(true);
          setExitConfirmIndex(0);
          if (onCloseSettings) onCloseSettings();
        }
      }}
      className="p-1.5 text-orange-500/70 hover:text-orange-400 transition-colors rounded-full hover:bg-orange-500/10 flex-shrink-0"
      title={isPlaylistMode && onClosePlaylist ? t('playlist.close') : t('header.leave')}
    >
      <ChevronLeft size={20} />
    </button>
  );

  const userIdentity = isSignedIn(user) ? (
    <button
      onClick={() => setShowProfileModal(true)}
      className="flex-shrink-0 rounded-full hover:ring-2 hover:ring-orange-500/30 transition-all"
      title={t('header.profileSettings')}
    >
      {user.picture ? (
        <img src={user.picture} alt={user.name} referrerPolicy="no-referrer" className="w-7 h-7 rounded-full border border-neutral-700" />
      ) : (
        <div className="w-7 h-7 rounded-full bg-neutral-800 flex items-center justify-center text-xs font-bold text-orange-500 border border-neutral-700">
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
          className={`flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full border border-neutral-700 bg-neutral-800/50 transition-all ${disabled ? 'opacity-40' : 'hover:ring-2 hover:ring-orange-500/30 active:scale-95'}`}
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

        <div className="h-5 w-px bg-neutral-800 flex-shrink-0" />

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

      {/* Mobile (< md): grid layout with two left-column rows + a tall
          right-column Suggest button spanning both rows. Top-left row
          groups branding, identity and the YouTube text attribution;
          bottom-left row is the scrollable pills strip with full width. */}
      <div className="md:hidden grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1.5 items-stretch">
        <div className="flex items-center gap-2 min-w-0">
          {wordmark}
          {backButton}
          {userIdentity}
          {showYouTubeAttribution && <YouTubeBrandSubtitle className="leading-tight text-center" />}
        </div>
        <div className="row-span-2 flex items-stretch">
          {suggestButtonTall}
        </div>
        <div className="overflow-x-auto no-scrollbar overscroll-x-contain touch-pan-x touch-pan-y flex items-center gap-1.5 min-w-0 py-0.5">
          {renderPills({ includeSuggest: false })}
        </div>
      </div>

      {
        showExitConfirm && createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl scale-100 animate-in zoom-in-95 duration-200 text-center">
              <h3 className="text-xl font-bold text-white mb-2">{t('header.leaveChannel')}</h3>
              <p className="text-neutral-400 mb-6">{t('header.leaveChannelConfirm')}</p>

              <div className="flex gap-3 justify-center">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowExitConfirm(false);
                  }}
                  className={`flex-1 px-4 py-3 rounded-xl font-bold transition-all border ${exitConfirmIndex === 0
                    ? "bg-neutral-700 text-white ring-2 ring-orange-500/50 border-transparent"
                    : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700 border-transparent"
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
                  className={`flex-1 px-4 py-3 rounded-xl font-bold transition-all border ${exitConfirmIndex === 1
                    ? "bg-orange-500 text-white ring-2 ring-orange-500/50 shadow-lg shadow-orange-500/20 border-transparent"
                    : "bg-red-900/30 text-red-400 hover:bg-red-900/50 border-red-900/50"
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
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
            onClick={() => onShowQRCode(false)}
          >
            <div
              className="qr-code-modal bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl scale-100 animate-in zoom-in-95 duration-200 text-center flex flex-col items-center"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-bold text-orange-500 mb-4">{t('header.share')}</h3>
              <div className="relative group">
                <div className="relative bg-neutral-900 p-4 rounded-xl mb-4 border border-orange-500/50">
                  <QRCodeSVG
                    value={window.location.href}
                    size={200}
                    level={"H"}
                    includeMargin={false}
                    fgColor={"#ffffff"}
                    bgColor={"transparent"}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 mb-6 bg-neutral-800/50 p-2 pl-4 rounded-xl w-full max-w-[280px] border border-neutral-800">
                <p className="text-neutral-400 text-sm overflow-x-auto whitespace-nowrap flex-1 font-mono no-scrollbar">{window.location.href}</p>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href)
                      .then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      })
                      .catch(() => { /* Clipboard denied or unavailable */ });
                  }}
                  className={`p-2 rounded-lg transition-all ${copied
                    ? "bg-green-500/10 text-green-500"
                    : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-white"
                    }`}
                  title={t('header.copyUrl')}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>



              <button
                onClick={() => onShowQRCode(false)}
                className="px-6 py-2 bg-neutral-800 hover:bg-neutral-700 text-orange-500 border border-orange-500/20 hover:border-orange-500/50 rounded-lg transition-all font-medium"
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
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
            onClick={() => setShowProfileModal(false)}
          >
            <div
              className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl scale-100 animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >

              <div className="flex flex-col items-center mb-6">
                {user?.picture ? (
                  <img src={user.picture} alt={user.name} referrerPolicy="no-referrer" className="w-20 h-20 rounded-full border-2 border-neutral-700 mb-4 shadow-xl" />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-neutral-800 flex items-center justify-center text-3xl font-bold text-neutral-500 mb-4 border-2 border-neutral-700">
                    {displayName(user, t).charAt(0)}
                  </div>
                )}
                <h3 className="text-xl font-bold text-white">{displayName(user, t)}</h3>
                <p className="text-sm text-neutral-400">{user?.email}</p>
              </div>

              {!showDeleteConfirm ? (
                <div className="space-y-3">
                  <button
                    onClick={() => {
                      onLogout();
                      setShowProfileModal(false);
                    }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-medium transition-colors border border-black/20"
                  >
                    <LogOut size={18} /> {t('lobby.signOut')}
                  </button>

                  <div className="pt-4 border-t border-neutral-800 mt-4 space-y-3">
                    <a
                      href="/legal"
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white font-medium transition-colors border border-black/20 text-sm"
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
                  <p className="text-sm text-neutral-400 mb-4 leading-relaxed" dangerouslySetInnerHTML={dangerousHtml(t('lobby.deleteAccountWarning'))} />

                  <div className="mb-6">
                    <label className="block text-xs text-neutral-500 mb-2 font-medium">
                      {t('lobby.deleteAccountType')} <span className="text-neutral-300 font-bold select-none">{t('lobby.deleteAccountPhrase')}</span> {t('lobby.deleteAccountToConfirm')}
                    </label>
                    <input
                      type="text"
                      value={deleteConfirmationText}
                      onChange={(e) => setDeleteConfirmationText(e.target.value)}
                      className="w-full bg-black/30 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500/50 transition-colors placeholder-neutral-700 font-mono"
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
                      className="flex-1 px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-medium transition-colors"
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
};
