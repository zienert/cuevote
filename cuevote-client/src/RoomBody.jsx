// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { deviceDetection } from './utils/deviceDetection';
import { Volume2, VolumeX, ArrowLeft, Lock, X, Maximize2, WifiOff, RefreshCw, AlertTriangle } from "lucide-react";
import { Consent } from './contexts/ConsentContext';
import { Language } from './contexts/LanguageContext';
import { Header } from "./components/Header";
import { SuggestSongForm } from "./components/SuggestSongForm";
import { Player } from "./components/Player";
import { AppleMusicHostPlayer } from "./components/AppleMusicHostPlayer";
import { JoinWelcome } from "./components/JoinWelcome";
import { useAppleMusicHost } from "./hooks/useAppleMusicHost";
import { parseTrackKey } from "./utils/trackKeys";
import { Queue } from "./components/Queue";
import { Suggestions } from "./components/Suggestions";
import { PlaylistView } from "./components/PlaylistView";
import { PrelistenOverlay } from "./components/PrelistenOverlay";
import { AppPromoFooter } from "./components/AppPromoFooter";
import { SettingsView } from "./components/SettingsView";
import { canParticipate, participationErrorKey } from "./utils/participation";
import { useLatestRef } from "./hooks/useLatestRef";
import { BannedVideosPage } from "./components/BannedVideos"; // Added this import
import { PlaybackControls } from "./components/PlaybackControls";
import { Skeleton } from "./components/Skeleton";
import { useWebSocketContext } from "./hooks/useWebSocketContext";

import PlayerErrorBoundary from "./components/PlayerErrorBoundary.jsx";
import { Toast } from "./components/Toast";
import { LoadingScreen } from "./components/LoadingScreen";



const YouTubeState = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
};

// "Stuck while supposed to be playing" deadline. If the server says playback
// is on but no PLAYING event has fired for this long, we escalate. Tuned to
// be longer than any reasonable buffering / first-load on a slow network so
// healthy-but-slow sessions don't trip it. The detector polls every 2s and
// self-refreshes the anchor whenever it observes the player IS playing, so
// during normal playback the anchor stays fresh and the deadline never
// triggers — it only fires when the player genuinely never reaches PLAYING.
const STUCK_DEADLINE_MS = 15 * 1000;

function RoomBody() {
  const [CookieBlockedPlaceholderComponent, setCookieBlockedPlaceholder] = useState(null);
  const [pendingRequestsExports, setPendingRequestsExports] = useState(null);
  useEffect(() => {
    import('./components/CookieBlockedPlaceholder').then((m) => setCookieBlockedPlaceholder(() => m.CookieBlockedPlaceholder));
    import('./components/PendingRequests').then((m) => setPendingRequestsExports(m.PendingRequestsExports));
  }, []);
  const { roomId } = useParams();

  const navigate = useNavigate();
  const location = useLocation();
  const activeRoomId = roomId || "synthwave";

  const [localPlaylistView, setLocalPlaylistView] = useState(false);
  const [playlistActiveTab, setPlaylistActiveTab] = useState("playlist");
  const [controlsHeight, setControlsHeight] = useState(96);
  const [showSettings, setShowSettings] = useState(false);
  // const [hasConsent, setHasConsent] = useState(() => !!localStorage.getItem("cuevote_cookie_consent"));
  const { hasConsent, hasAppleConsent, giveAppleConsent } = Consent.useConsent();
  const { t } = Language.useLanguage();

  // console.log("App Component MOUNTED, Room:", activeRoomId);

  // Online Status & Device Class Injection
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  useEffect(() => {
    const handleStatusChange = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', handleStatusChange);
    window.addEventListener('offline', handleStatusChange);

    // Inject Device Classes for CSS targeting
    if (deviceDetection.isMobile()) document.body.classList.add('is-mobile');
    else document.body.classList.remove('is-mobile');

    if (deviceDetection.isTablet()) document.body.classList.add('is-tablet');
    else document.body.classList.remove('is-tablet');

    if (deviceDetection.isTV()) document.body.classList.add('is-tv');
    else document.body.classList.remove('is-tv');

    return () => {
      window.removeEventListener('online', handleStatusChange);
      window.removeEventListener('offline', handleStatusChange);
    };
  }, []);

  // Native Bridge: Sync QR Button State


  // WebSocket connection (Shared)
  const {
    state: serverState,
    isConnected,
    sendMessage,
    lastError,
    lastErrorCode,
    lastErrorTimestamp,
    lastMessage,
    user,
    handleLogout,
    handleLoginSuccess,
    reconnectAttempt,
    forceReconnect,
    progressRef,
  } = useWebSocketContext();

  // Debounce the reconnecting banner — brief mobile disconnects (< 2.5 s) shouldn't flash a banner
  const [showReconnectBanner, setShowReconnectBanner] = useState(false);
  useEffect(() => {
    if (isConnected) {
      setShowReconnectBanner(false);
      return;
    }
    const timer = setTimeout(() => setShowReconnectBanner(true), 2500);
    return () => clearTimeout(timer);
  }, [isConnected]);

  // Handle Delete Account Success (Moved up to avoid conditional hook call error)
  useEffect(() => {
    if (lastMessage && lastMessage.type === "DELETE_ACCOUNT_SUCCESS") {
      if (import.meta.env.DEV) {
        console.log("Account deleted successfully");
      }
      handleLogout();
      navigate('/');
    }
    if (lastMessage && (lastMessage.type === "ROOM_DELETED" || (lastMessage.type === "error" && lastMessage.code === "ROOM_DELETED"))) {
      if (import.meta.env.DEV) {
        console.log("Room deleted, navigating to lobby");
      }
      navigate('/');
    }
  }, [lastMessage, handleLogout, navigate]);

  const handleDeleteAccount = () => {
    sendMessage({ type: "DELETE_ACCOUNT", payload: {} });
  };

  const handleDeleteChannel = () => {
    if (import.meta.env.DEV) {
      console.log("SENDING DELETE_ROOM message");
    }
    sendMessage({ type: "DELETE_ROOM", payload: {} });
  };

  // Destructure server state (Moved up for useEffect access)
  const {
    roomId: serverRoomId,
    queue = [],
    currentTrack = null,
    isPlaying = false,
    progress: _serverProgress = 0,
    activeChannel = "Synthwave",
    ownerId = null,
    suggestionsEnabled = true,
    musicOnly = false,
    maxDuration = 600,
    allowPrelisten = true,
    ownerBypass = true,
    maxQueueSize = 50,
    smartQueue = true,
    playlistViewMode = false,
    history = [],
    suggestionMode = 'auto',
    pendingSuggestions = [],
    ownerPopups = true,
    duplicateCooldown = 10,
    autoApproveKnown = true,
    autoRefill = false,
    bannedVideos = [], // Added this
    captionsEnabled = false,
    requireLogin = false,
    provider = 'youtube'
  } = serverState || {};
  // Apple Music rooms play only on the owner's device (MusicKit needs the
  // host's own subscription); everyone else gets the playlist view.
  const isAppleRoom = provider === 'apple';
  // The consent the player of this channel needs: Apple's or YouTube's.
  const playerConsent = isAppleRoom ? hasAppleConsent : hasConsent;

  // Calculate set of ALL videoIds currently in the queue or playing for suggestion "Added" check
  const queueVideoIds = useMemo(() => {
    const ids = new Set();
    if (currentTrack?.videoId) ids.add(currentTrack.videoId);
    if (queue) {
      queue.forEach(t => {
        if (t.videoId) ids.add(t.videoId);
      });
    }
    return ids;
  }, [queue, currentTrack]);

  const upcomingCount = useMemo(
    () => queue.filter(t => t.id !== currentTrack?.id).length,
    [queue, currentTrack]
  );

  useEffect(() => {
    if (upcomingCount === 0) {
      setIsQueueMinimized(true);
    }
  }, [upcomingCount]);

  const isOwner = user && ownerId && user.id === ownerId;
  // TV always ignores Venue Mode (shows video).
  // FORCED Venue Mode: a mobile WEB browser (iOS or Android, NOT running in the
  // native app) can't reliably autoplay video, so we force vote/suggest-only
  // regardless of room settings. Distinct from the owner-configured
  // playlistViewMode below (e.g. desktop, where playback works fine).
  const isForcedVenueMode = deviceDetection.isMobileWebBrowser();
  const isVenueMode = (playlistViewMode && !isOwner && !deviceDetection.isTV()) || isForcedVenueMode
    || (isAppleRoom && !isOwner);
  // Prelisten streams audio through the YT player. Disable it ONLY in forced
  // Venue Mode (mobile browser + app not running) — unreliable there and outside
  // the browser feature set we advertise. Configured venue mode keeps prelisten.
  // Apple rooms have no YouTube player to prelisten with.
  const prelistenEnabled = allowPrelisten && !isForcedVenueMode && !isAppleRoom;
  const apple = useAppleMusicHost({
    enabled: isAppleRoom && !!isOwner && hasAppleConsent && !isForcedVenueMode,
    currentTrack,
    isPlaying,
    progressRef,
    sendMessage,
  });
  // Android web guests can sideload the native app; offer it via a footer + a
  // pre-download comparison. iOS cannot sideload, so it never sees this.
  const showAppFooter = deviceDetection.isAndroid() && !deviceDetection.isNativeApp();
  // TV always defaults to Fullscreen (CinemaMode), unless manually exited
  const isAnyPlaylistView = isVenueMode || localPlaylistView;

  const [isCinemaMode, setIsCinemaMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    return deviceDetection.isTV() || ((deviceDetection.isMobile() && !deviceDetection.isTablet()) && window.matchMedia("(orientation: landscape)").matches);
  });

  // Force exit cinema mode when Venue Mode is activated
  useEffect(() => {
    if (isVenueMode) {
      setIsCinemaMode(false);
    }
  }, [isVenueMode]);

  // Pending Suggestions Handlers
  const handleApproveSuggestion = (trackId) => {
    sendMessage({ type: "APPROVE_SUGGESTION", payload: { trackId } });
  };

  const handleRejectSuggestion = (trackId) => {
    sendMessage({ type: "REJECT_SUGGESTION", payload: { trackId } });
  };

  const handleBanSuggestion = (trackId) => {
    sendMessage({ type: "BAN_SUGGESTION", payload: { trackId } });
  };

  const handleUnbanSong = (videoId) => {
    sendMessage({ type: "UNBAN_SONG", payload: { videoId } });
  };

  // Trace Render Cycle
  // console.log(`[CLIENT TRACE] App Render.Active: ${activeRoomId}, Server: ${serverRoomId}, Stale ? ${serverState && serverRoomId && (serverRoomId.toString().trim().toLowerCase() !== activeRoomId.toString().trim().toLowerCase())} `);

  // Join Room on Connect or Room Change
  // const location = useLocation();

  // Password Modal State
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const lastPasswordAttemptRef = useRef(null); // Track the last password we sent
  const knownPasswordRef = useRef(null); // Password that successfully joined this room (reused on rejoin)
  const prevIsConnectedRef = useRef(false);

  // Password retention is per-room: switching rooms must not leak the
  // previous room's password into the next join attempt.
  useEffect(() => {
    lastPasswordAttemptRef.current = null;
    knownPasswordRef.current = null;
  }, [activeRoomId]);

  useEffect(() => {
    if (isConnected) {
      const isNewConnection = !prevIsConnectedRef.current;
      prevIsConnectedRef.current = true;

      if (!isNewConnection) {
        // Only apply "already in room" guards when NOT reconnecting.
        // After a reconnect the server has forgotten this client, so we must rejoin.
        if (location.state?.alreadyJoined && activeRoomId === serverRoomId) {
          if (import.meta.env.DEV) {
            console.log("[App] Skipping join, already joined from Lobby");
          }
          return;
        }
        if (serverRoomId && activeRoomId && serverRoomId.toString().trim().toLowerCase() === activeRoomId.toString().trim().toLowerCase()) {
          if (import.meta.env.DEV) {
            console.log("[App] Skipping join, already in target room:", activeRoomId);
          }
          return;
        }
      } else {
        if (import.meta.env.DEV) {
          console.log("[App] New connection detected, forcing room join:", activeRoomId);
        }
      }

      // Prefer a password the user is currently trying or one that already
      // worked. The server re-checks the password on every JOIN_ROOM (and
      // removes the client from the room before doing so), so a rejoin with
      // an undefined password would kick the user back to the modal.
      const password = lastPasswordAttemptRef.current || knownPasswordRef.current || location.state?.password;
      lastPasswordAttemptRef.current = password;
      sendMessage({ type: "JOIN_ROOM", payload: { roomId: activeRoomId, password } });
    } else {
      prevIsConnectedRef.current = false;
    }
  }, [isConnected, activeRoomId, sendMessage, location.state, serverRoomId]);

  // Handle Password Required Error
  useEffect(() => {
    if (lastErrorCode === "PASSWORD_REQUIRED") {
      setShowPasswordModal(true);
      if (lastPasswordAttemptRef.current) {
        setPasswordError("Incorrect password");
      } else {
        setPasswordError("");
      }
    }
  }, [lastErrorCode, lastErrorTimestamp]);

  const [showQRModal, setShowQRModal] = useState(false);
  const [headerOverlay, setHeaderOverlay] = useState(false);
  const [settingsOverlay, setSettingsOverlay] = useState(false);

  // Clear modal on successful join
  useEffect(() => {
    if (serverState && serverRoomId && activeRoomId && serverRoomId.toLowerCase() === activeRoomId.toLowerCase()) {
      setShowPasswordModal(false);
      setPasswordError("");
      if (lastPasswordAttemptRef.current) {
        // Remember the password that worked so reconnect rejoins (which the
        // server re-validates) don't bounce the user back to the modal.
        knownPasswordRef.current = lastPasswordAttemptRef.current;
      }
      lastPasswordAttemptRef.current = null; // Reset

      // Auto-open Share Modal if requested (e.g. new channel)
      if (location.state?.showShareOnLoad) {
        setShowQRModal(true);
        // Clear the state so it doesn't trigger again on subsequent updates
        navigate(location.pathname, { replace: true, state: { ...location.state, showShareOnLoad: false } });
      }
    }
  }, [serverState, serverRoomId, activeRoomId, location.state, location.pathname, navigate]);


  const submitPasswordJoin = (e) => {
    e.preventDefault();
    setPasswordError(""); // Clear previous errors
    lastPasswordAttemptRef.current = passwordInput; // Track it
    sendMessage({ type: "JOIN_ROOM", payload: { roomId: activeRoomId, password: passwordInput } });
    // Do NOT close modal here. Wait for success or error.
    // setShowPasswordModal(false); 
    // setPasswordInput("");
  };

  // Connected-but-no-state guard: if WebSocket is connected but we never received
  // state (e.g. JOIN_ROOM was lost, or server response was corrupted), retry.
  useEffect(() => {
    if (!isConnected || serverState) return;
    const timer = setTimeout(() => {
      if (import.meta.env.DEV) {
        console.warn("[App] Connected but no state received in 5s. Resending JOIN_ROOM.");
      }
      const password = lastPasswordAttemptRef.current || knownPasswordRef.current || location.state?.password;
      sendMessage({ type: "JOIN_ROOM", payload: { roomId: activeRoomId, password } });
    }, 5000);
    return () => clearTimeout(timer);
  }, [isConnected, serverState, activeRoomId, sendMessage, location.state]);

  // Stale State Guard: If we switched rooms but serverState is still from the old room, show loading.
  const isStaleState = serverState && serverRoomId && (serverRoomId.toString().trim().toLowerCase() !== activeRoomId.toString().trim().toLowerCase());

  useEffect(() => {
    let timeout;
    if (isConnected && isStaleState) {
      if (import.meta.env.DEV) {
        console.warn(`[STALE DEBUG] Wanted: ${activeRoomId}, Got: ${serverRoomId}. Retrying in 3s...`);
      }
      timeout = setTimeout(() => {
        if (import.meta.env.DEV) {
          console.warn(`[STALE DEBUG] Sending JOIN_ROOM for ${activeRoomId}`);
        }
        const password = lastPasswordAttemptRef.current || knownPasswordRef.current || location.state?.password;
        sendMessage({ type: "JOIN_ROOM", payload: { roomId: activeRoomId, password } });
      }, 3000);
    }
    return () => clearTimeout(timeout);
  }, [isConnected, isStaleState, activeRoomId, serverRoomId, sendMessage, location.state]);

  // Local UI state
  const [expandedTrackId, setExpandedTrackId] = useState(null);
  const [isMuted, setIsMuted] = useState(true);
  const [showSuggest, setShowSuggest] = useState(false);
  // Set to true the first time onStateChange fires PLAYING. Used to gate the
  // owner-side stall-detection escalation so a slow first-load can't be
  // misreported as a stall.
  const hasEverPlayedRef = useRef(false);

  // Suggestion state (must be declared before effects that use it)
  const [manualSuggestions, setManualSuggestions] = useState([]);
  const [activeSuggestionId, setActiveSuggestionId] = useState(null);
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);
  const [networkThrottle, setNetworkThrottle] = useState(null); // { until: timestamp } when YouTube throttles the venue IP
  const THROTTLE_DISMISS_KEY = 'cuevote_throttle_dismissed_until';
  const isThrottleDismissActive = useCallback(() => {
    try {
      const until = localStorage.getItem(THROTTLE_DISMISS_KEY);
      return until && Date.now() < parseInt(until, 10);
    } catch { return false; }
  }, []);
  const [throttleDismissed, setThrottleDismissed] = useState(isThrottleDismissActive);
  const dismissThrottle = useCallback(() => {
    try { localStorage.setItem(THROTTLE_DISMISS_KEY, String(Date.now() + 30 * 60 * 1000)); } catch { /* localStorage may be unavailable (Safari private mode) */ }
    setThrottleDismissed(true);
  }, []);
  const clearThrottleDismiss = useCallback(() => {
    try { localStorage.removeItem(THROTTLE_DISMISS_KEY); } catch { /* localStorage may be unavailable */ }
    setThrottleDismissed(false);
  }, []);

  // Fix: Use Ref to track showSuggeststate to suppress global toasts when bar is open
  const showSuggestRef = useLatestRef(showSuggest);

  const [toast, setToast] = useState(null);

  useEffect(() => {
    // If Suggest Bar is open, suppress global toasts (errors/messages shown inline)
    if (showSuggestRef.current) return;

    if (lastError) {
      // The server answers in English. Where it also sends a code, show the
      // translated string instead — this room has 35 languages and its refusals
      // should not be the one place that ignores them.
      const key = participationErrorKey(lastErrorCode);
      const errorMessage = key
        ? t(key)
        : (typeof lastError === 'string' ? lastError : lastError.message || "An error occurred");
      setToast({ message: errorMessage, type: "error" });
    }
  }, [lastError, lastErrorCode, lastErrorTimestamp, showSuggestRef, t]);

  useEffect(() => {
    // If Suggest Bar is open, suppress global toasts
    if (showSuggestRef.current) return;

    if (lastMessage) {
      if (lastMessage.type === 'info') setToast({ message: lastMessage.message, type: "info" });
      else if (lastMessage.type === 'success') {
        if (lastMessage.message === "Added") return; // Suppress redundant "Success" popup for video additions
        setToast({ message: lastMessage.payload || "Success", type: "success" });
      }
      // A coded error was already shown translated by the effect above; showing
      // the server's English text here would overwrite it in the same render.
      else if (lastMessage.type === 'error' && !participationErrorKey(lastMessage.code)) {
        setToast({ message: lastMessage.message, type: "error" });
      }
    }
  }, [lastMessage, showSuggestRef]);

  // Handle VIDEO_STATUS from server (playback error diagnosis)
  useEffect(() => {
    if (!lastMessage || lastMessage.type !== "VIDEO_STATUS") return;
    const { videoId, status } = lastMessage.payload || {};
    if (!videoId) return;

    // Server-confirmed genuinely-unavailable videos (private/rejected/deleted/not-
    // embeddable) shouldn't count toward the local IP-block heuristic, which is
    // populated by the player's onError handler from errors 101/150 — those errors
    // fire for both true IP blocks and per-video embed restrictions, indistinguishable
    // client-side. Remove server-confirmed unavailable entries so two unrelated
    // unembeddable videos in a session can't combine to falsely trigger the overlay.
    // ip_blocked/check_failed/no_api_key come with NETWORK_THROTTLE — that path is
    // the authoritative IP-block signal, so no client-side counter is needed.
    // Refresh the playback timer on a server-confirmed unavailable skip so the
    // "stuck while supposed to be playing" detector doesn't mistake a series of
    // legitimate skips (auto-DJ refill of stale items, music-only filter
    // rejections) for a stuck player.
    if (['private', 'rejected', 'not_embeddable', 'unavailable'].includes(status)) {
      lastSuccessfulPlayRef.current = Date.now();
      stuckReportedRef.current = false;
    }

    if (isOwner) {
      const title = currentTrack?.title || 'Track';
      if (status === 'ip_blocked' || status === 'check_failed' || status === 'no_api_key') {
        // NETWORK_THROTTLE banner follows immediately — no toast needed to avoid duplicate messaging
      } else {
        setToast({
          message: t('playlist.skippedRestricted', { title }),
          type: "error"
        });
      }
    }
  }, [lastMessage, isOwner, currentTrack, t]);

  // Handle NETWORK_THROTTLE from server (venue IP is being throttled by YouTube)
  useEffect(() => {
    if (!lastMessage || lastMessage.type !== "NETWORK_THROTTLE") return;
    const { until } = lastMessage.payload || {};
    setNetworkThrottle({ until: until || (Date.now() + 15 * 60 * 1000) });
    if (!isThrottleDismissActive()) setIpBlockDetected(true);
  }, [lastMessage, isThrottleDismissActive]);

  // No auto-clear for network throttle — IP blocks last hours, not minutes.
  // The banner clears only when the owner presses Retry and playback succeeds
  // (server resets state on PLAY_PAUSE:true and UPDATE_DURATION).

  // Handle manual suggestion results from server
  useEffect(() => {
    if (!lastMessage || lastMessage.type !== "SUGGESTION_RESULT") return;
    if (!activeSuggestionId) return; // Ignore if no suggestion panel is open

    const suggestions = lastMessage.payload?.suggestions || [];
    setManualSuggestions(suggestions);
    setIsFetchingSuggestions(false);
  }, [lastMessage, activeSuggestionId]);
  const [showPendingPage, setShowPendingPage] = useState(false);
  const [showBannedPage, setShowBannedPage] = useState(false); // Added this
  // On mobile, the OS volume slider is the only loudness control that matters
  // (per-tab volume is rarely exposed); start at 100% so the OS can do its job
  // without our app slider artificially capping it.
  const [volume, setVolume] = useState(() => deviceDetection.isMobile() ? 100 : 80);
  const [isQueueMinimized, setIsQueueMinimized] = useState(true);
  const [isLocallyPaused, setIsLocallyPaused] = useState(false);
  const [isLocallyPlaying, setIsLocallyPlaying] = useState(false);
  const [previewTrack, setPreviewTrack] = useState(null);
  // const [user, setUser] = useState(null); // Now from Context
  const [progress, setProgress] = useState(0);
  const [playbackError, setPlaybackError] = useState(null); // New State: Track playback errors
  // The single source of truth for "is playback healthy?" is whether PLAYING
  // events fire on a regular cadence. lastSuccessfulPlayRef is the timestamp
  // of the most recent PLAYING (initialised to mount time so a fresh join has
  // a clean window). stuckReportedRef debounces the escalation — we report
  // 'stuck_on_load' to the server (or fire the overlay locally for guests)
  // at most once per "stuck episode"; the next PLAYING resets it.
  const lastSuccessfulPlayRef = useRef(Date.now());
  const stuckReportedRef = useRef(false);
  const [ipBlockDetected, setIpBlockDetected] = useState(false);
  const [roomNotFound, setRoomNotFound] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true); // Track footer visibility
  const [isWindowTooSmall, setIsWindowTooSmall] = useState(false);

  // Monitor Window Size for TOS Compliance & Reactive Layout
  const [windowHeight, setWindowHeight] = useState(window.innerHeight);

  useEffect(() => {
    const handleResize = () => {
      setWindowHeight(window.innerHeight);

      let tooSmall = false;
      if (isCinemaMode) {
        // Strict TOS Minimum in Cinema Mode (200x200)
        tooSmall = window.innerWidth < 200 || window.innerHeight < 200;
      } else {
        // Standard UI Minimum (360x400)
        tooSmall = window.innerWidth < 360 || window.innerHeight < 400;
      }
      setIsWindowTooSmall(tooSmall);
    };

    // Check initially
    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isCinemaMode]);

  // Mobile Auto-Fullscreen on Landscape
  useEffect(() => {
    // Only apply to Smartphones (Mobile but not Tablet)
    if (!deviceDetection.isMobile() || deviceDetection.isTablet()) return;

    const mediaQuery = window.matchMedia("(orientation: landscape)");

    const handleOrientationChange = (e) => {
      const isLandscape = e.matches;

      // Auto-Enter Cinema Mode in Landscape
      if (isLandscape) {
        setIsCinemaMode(true);
      }
      // Auto-Exit Cinema Mode in Portrait
      else {
        setIsCinemaMode(false);
      }
    };

    // Check initially
    // We manually trigger it based on current matches to set initial state correctly
    if (mediaQuery.matches && !isCinemaMode) {
      setIsCinemaMode(true);
    }

    // Add Listener
    mediaQuery.addEventListener("change", handleOrientationChange);
    return () => mediaQuery.removeEventListener("change", handleOrientationChange);
  }, [isCinemaMode]); // Dependency mainly for access to current state if needed, though media query is robust

  // Smart Bar Logic: Intercept visibility changes to enforce TOS
  // Smart Bar Logic: Intercept visibility changes to enforce TOS
  // Smart Bar Logic: Reactive constraints
  // If isCinemaMode, we only allow controls if window is tall enough (200px + bar height)
  const canShowControls = !isCinemaMode || (windowHeight >= 200 + controlsHeight);

  // Updated Handler: We blindly accept what the child tells us, 
  // because the child now respects 'canShowControls' which we pass down.
  const handleVisibilityChange = useCallback((visible) => {
    setControlsVisible(visible);
  }, []);

  const handleControlsHeightChange = useCallback((height) => {
    setControlsHeight(height);
  }, []);

  // Handle Escape Key for App-level modals
  useEffect(() => {
    const handleEscape = (e) => {
      // Prevent Backspace from closing modals while typing
      if (e.key === 'Backspace' && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        return;
      }

      // Allow "Back", "Escape", or "ArrowLeft" on TV to exit Cinema Mode
      if (e.key === 'Escape' || e.key === 'Backspace' || (deviceDetection.isTV() && e.key === 'ArrowLeft')) {
        if (showPendingPage) setShowPendingPage(false);
        else if (showBannedPage) setShowBannedPage(false);
        else if (showSuggest) setShowSuggest(false);
        else if (showQRModal) setShowQRModal(false);
        else if (showPasswordModal) { /* navigate('/'); */ }
        else if (isCinemaMode) {
          setIsCinemaMode(false);
        }
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [showPendingPage, showBannedPage, showSuggest, showQRModal, showPasswordModal, isCinemaMode]);

  // Auth: Resume Session logic moved to Provider

  // Auth: Handle Login Events logic moved to Provider? 
  // We still need to trigger the context update if we want.
  // Actually, let's update the Provider to handle user state.

  // YouTube Player state
  const playerRef = useRef(null);
  const playerInitIdRef = useRef(0);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const volumeRef = useLatestRef(volume);
  const isMutedRef = useLatestRef(isMuted);
  const isPlayingRef = useLatestRef(isPlaying); // Latest server state, for event handlers bound once
  const isOwnerRef = useLatestRef(isOwner);






  const currentTrackRef = useRef(currentTrack);
  // Clear a stale playback error only when the track actually changes.
  // isPlayerReady must NOT be a dependency here: the error panel replaces
  // <Player>, which destroys the player and flips isPlayerReady — clearing
  // the error on that flip would remount the player, reload the same
  // failing video and loop destroy/recreate forever.
  useEffect(() => {
    currentTrackRef.current = currentTrack;
    setPlaybackError(null);
  }, [currentTrack]);

  // The YT player is shared between room playback and prelisten, and its
  // event handlers are bound once at construction — they need a ref to know
  // whether the video they are reporting on is a preview. Clearing
  // playbackError on preview start/end keeps a room-track error from
  // blocking the preview player and a preview error from outliving the
  // preview.
  const previewTrackRef = useRef(previewTrack);
  useEffect(() => {
    previewTrackRef.current = previewTrack;
    setPlaybackError(null);
  }, [previewTrack]);

  useEffect(() => {
    if (isPlayerReady && playerRef.current) {
      try {
        if (captionsEnabled && currentTrack?.language) {
          if (import.meta.env.DEV) {
            console.log("[Player] Setting Caption Language:", currentTrack.language);
          }
          playerRef.current.setOption && playerRef.current.setOption('captions', 'track', { languageCode: currentTrack.language });
        } else {
          // Explicitly clear captions if disabled
          if (import.meta.env.DEV) {
            console.log("[Player] Clearing Captions (Disabled)");
          }
          playerRef.current.setOption && playerRef.current.setOption('captions', 'track', {});
        }
      } catch (e) {
        console.error("Failed to set/clear caption language", e);
      }
    }
  }, [currentTrack, isPlayerReady, captionsEnabled]);


  // YouTube API Loading
  const loadYouTubeAPI = useCallback(() => {
    return new Promise((resolve, reject) => {
      if (!hasConsent) return reject("No Consent"); // Gate API Load

      if (window.YT && window.YT.Player) {
        return resolve(window.YT);
      }
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.onload = () => {
        window.onYouTubeIframeAPIReady = () => resolve(window.YT);
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }, [hasConsent]);

  // Player Initialization
  const initializePlayer = useCallback((container) => {
    if (!hasConsent) return;
    const initId = ++playerInitIdRef.current;
    loadYouTubeAPI().then((YT) => {
      if (initId !== playerInitIdRef.current) return;
      if (playerRef.current && typeof playerRef.current.destroy === 'function') {
        try { playerRef.current.destroy(); } catch { /* already gone */ }
        playerRef.current = null;
      }
      playerRef.current = new YT.Player(container, {
        host: 'https://www.youtube.com',
        playerVars: {
          autoplay: 0,
          // Hide YouTube's native chrome (scrubber, volume, mute, "more videos").
          // Our app's controls are the single source of truth — without this,
          // users could scrub off-sync from the server or unmute via the iframe
          // without our React state catching up. The YouTube logo bottom-right
          // stays visible, satisfying the IFrame API branding requirement.
          controls: 0,
          origin: window.location.origin,
          widget_referrer: window.location.origin,
          cc_load_policy: captionsEnabled ? 1 : 0,
          cc_lang_pref: currentTrackRef.current?.language,
          hl: currentTrackRef.current?.language
        },
        events: {
          onReady: (event) => {
            // console.log("[Player] YouTube Player onReady fired");
            setIsPlayerReady(true);
            // Anchor the stuck-deadline detector's "last successful play"
            // timestamp to now whenever a fresh player becomes ready. Without
            // this, a stale anchor from before a remount (e.g. user came back
            // from Playlist view) could already be older than the deadline,
            // so the detector would fire immediately on remount before the
            // first PLAYING event has had a chance to refresh it.
            lastSuccessfulPlayRef.current = Date.now();
            event.target.setVolume(volumeRef.current);
            if (isMutedRef.current) {
              event.target.mute();
            } else {
              event.target.unMute();
            }
          },
          onStateChange: (event) => {
            const state = event.data;
            if (state === YouTubeState.PLAYING) {
              setIsLocallyPaused(false);
              lastSuccessfulPlayRef.current = Date.now();
              stallRetriesRef.current = 0;
              stuckReportedRef.current = false;
              hasEverPlayedRef.current = true;
              // A confirmed PLAYING means playback is healthy right now. Auto-
              // clear any block overlay / throttle banner that may have been
              // raised by an earlier transient — the user shouldn't be staring
              // at a "playback restricted" screen while the video is playing.
              // Real blocks re-fire from NETWORK_THROTTLE or the stuck-deadline
              // detector below the moment playback breaks again.
              setIpBlockDetected(false);
              setNetworkThrottle(null);
              setPlaybackError(null);

              // Only set override if the SERVER is not currently playing.
              // If Server IS playing, then this event is likely just a sync result, so we are synced (local=false).
              // If Server is PAUSED (!isPlaying), and we play, it's a manual override.
              if (!isPlayingRef.current) {
                setIsLocallyPlaying(true);
              } else {
                setIsLocallyPlaying(false);
              }

              // Never report a preview's duration: the server writes the
              // payload into currentTrack.duration and would cut the room's
              // track short (or hold it open) for everyone.
              const duration = event.target.getDuration();
              if (duration && duration > 0 && !previewTrackRef.current) {
                sendMessage({ type: "UPDATE_DURATION", payload: duration });
              }
            } else if (state === YouTubeState.PAUSED) {
              // If user pauses manually in the iframe, respect it locally
              // BUT: if this pause comes from a server sync (i.e. server is paused), we shouldn't treat it as a local override.
              // We only want to set isLocallyPaused=true if we are pausing *against* the server state (i.e. server is playing).
              setIsLocallyPaused(isPlayingRef.current);
              setIsLocallyPlaying(false);
            }
          },
          onError: (event) => {
            if (import.meta.env.DEV) {
              console.error("YouTube Player Error:", event.data);
            }
            const errorCode = event.data;
            // The owner is the source of truth for genuine playback issues:
            // forward the error to the server so its API check can decide
            // whether the video is unavailable (skip it) or the network is
            // blocked (broadcast NETWORK_THROTTLE). Guests just surface a
            // local indicator — multi-error counting on the client is what
            // produced the false-positive overlays we kept hitting, so the
            // overlay is now driven purely by NETWORK_THROTTLE and the
            // stuck-deadline detector.
            //
            // Error 153 was added by YouTube in late 2025 and indicates the
            // request didn't include a valid HTTP Referer / API Client
            // identification. It surfaces in WebViews and any context where
            // the referer is stripped. Treat it the same as 100/101/150 —
            // the server's API check disambiguates "video unavailable" from
            // "network can't authenticate the embed" and broadcasts
            // NETWORK_THROTTLE in the latter case.
            //
            // Errors while a prelisten is loaded belong to the preview video,
            // not the room's current track. Reporting them as PLAYBACK_ERROR
            // would make the server API-check the (perfectly fine) current
            // track and conclude "IP block" — pausing the whole room under a
            // 6h network throttle. Surface them locally in the preview
            // overlay instead.
            if (previewTrackRef.current) {
              setPlaybackError(errorCode);
              return;
            }
            if ([100, 101, 150, 153].includes(errorCode)) {
              if (isOwnerRef.current) {
                if (import.meta.env.DEV) {
                  console.warn("[Player] Video error. Sending to server for verification...", currentTrackRef.current?.title);
                }
                sendMessage({
                  type: "PLAYBACK_ERROR",
                  payload: {
                    videoId: currentTrackRef.current?.videoId,
                    errorCode
                  }
                });
              } else {
                if (import.meta.env.DEV) {
                  console.warn("[Player] Playback Error shown to guest:", errorCode);
                }
                setPlaybackError(errorCode);
              }
            } else {
              if (!isOwnerRef.current) {
                setPlaybackError(errorCode);
              }
            }
          },
        },
      });
    });
  }, [loadYouTubeAPI, sendMessage, hasConsent, captionsEnabled, volumeRef, isMutedRef, isPlayingRef, isOwnerRef]);

  const playerContainerRef = useCallback(node => {
    if (!hasConsent) return;
    if (node !== null) {
      // Never a YouTube player in an Apple Music room: it would try to load
      // Apple track keys as YouTube ids and report the failures.
      if (isAppleRoom) return;
      initializePlayer(node);
    } else {
      playerInitIdRef.current++;
      if (playerRef.current && typeof playerRef.current.destroy === 'function') {
        try {
          playerRef.current.destroy();
        } catch (e) {
          if (import.meta.env.DEV) {
            console.error("Player cleanup error", e);
          }
        }
        playerRef.current = null;
        setIsPlayerReady(false);
        stallRetriesRef.current = 0;
      }
    }
  }, [initializePlayer, hasConsent, isAppleRoom]);

  // Main playback logic. The player starts muted by default (isMuted=true),
  // which lets the browser allow muted autoplay even before any user
  // interaction — so loadVideoById both loads and starts playing immediately,
  // no cued state or overlay needed. Audio stays silent until the user clicks
  // unmute via our controls.
  useEffect(() => {
    const targetTrack = previewTrack || currentTrack;
    if (isPlayerReady && playerRef.current && targetTrack) {
      const currentVideoIdInPlayer = playerRef.current.getVideoData?.()?.video_id;
      if (targetTrack.videoId !== currentVideoIdInPlayer) {
        const startTime = previewTrack ? 0 : progressRef.current;
        playerRef.current.loadVideoById?.(targetTrack.videoId, startTime);
      }
    } else if (isPlayerReady && playerRef.current && !targetTrack) {
      playerRef.current.stopVideo?.();
    }
  }, [isPlayerReady, currentTrack, previewTrack, progressRef]);

  const tvUnmuteVisible = deviceDetection.isTV() && isMuted && isPlayerReady && !isAnyPlaylistView;
  const hasFullscreenOverlay = showQRModal || headerOverlay || settingsOverlay || showSettings || tvUnmuteVisible;

  useEffect(() => {
    if (isPlayerReady && playerRef.current) {
      if (hasFullscreenOverlay) {
        playerRef.current.pauseVideo?.();
      } else if (previewTrack) {
        playerRef.current.playVideo?.();
      } else if ((isPlaying || isLocallyPlaying) && !isLocallyPaused) {
        playerRef.current.playVideo?.();
      } else {
        playerRef.current.pauseVideo?.();
      }
    }
  }, [isPlayerReady, isPlaying, currentTrack, isLocallyPaused, isLocallyPlaying, previewTrack, hasFullscreenOverlay]);

  useEffect(() => {
    if (!isPlayerReady || !playerRef.current || !isPlaying || previewTrack) return;
    const interval = setInterval(() => {
      if (playerRef.current?.getPlayerState?.() === YouTubeState.ENDED) return;
      const localProgress = playerRef.current?.getCurrentTime?.();
      if (localProgress && Math.abs(localProgress - progressRef.current) > 3) {
        playerRef.current?.seekTo?.(progressRef.current);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [isPlayerReady, isPlaying, previewTrack, progressRef]);

  // Infinite Load Guard (Stall Detection)
  const stallRetriesRef = useRef(0); // Track number of stall retries

  // Returning from a backgrounded tab: refresh the playback timer anchor and,
  // if the server says we should be playing but the player isn't, nudge it.
  // Browsers throttle backgrounded iframes — Chrome can pause a track that
  // started loading while the tab was hidden, leaving it stuck in UNSTARTED
  // when the user returns. Without an explicit nudge, the playback effect
  // doesn't auto-call playVideo() (its deps haven't changed), so the player
  // would sit there until the user clicked play. Refreshing the anchor +
  // calling playVideo() on return covers all the "tab was inactive, now I'm
  // back, video should resume" cases.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        stallRetriesRef.current = 0;
        stuckReportedRef.current = false;
        lastSuccessfulPlayRef.current = Date.now();
        if (
          isPlayerReady
          && playerRef.current
          && currentTrack
          && isPlaying
          && !isLocallyPaused
          && !hasFullscreenOverlay
          && !previewTrack
        ) {
          const state = playerRef.current.getPlayerState?.();
          // Nudge any non-PLAYING state EXCEPT ENDED. CUED (autoplay-
          // blocked while hidden) might now be unblocked because the user
          // just brought the tab to the foreground; if the browser still
          // blocks, playVideo() silently fails — no harm. UNSTARTED /
          // BUFFERING / PAUSED all benefit from the explicit kick.
          // ENDED is skipped because YT.Player.playVideo() on an ended
          // video restarts it from the beginning — if a track ended while
          // the tab was hidden and the server hasn't advanced yet, we'd
          // briefly replay the just-finished track until currentTrack
          // changes. Let the playback effect load the next track instead.
          if (state !== YouTubeState.PLAYING && state !== YouTubeState.ENDED) {
            try { playerRef.current.playVideo?.(); } catch { /* gone */ }
          }
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isPlayerReady, currentTrack, isPlaying, isLocallyPaused, hasFullscreenOverlay, previewTrack]);

  useEffect(() => {
    // Reset retries when track changes
    stallRetriesRef.current = 0;
  }, [currentTrack]);

  useEffect(() => {
    if (!isPlaying || !isPlayerReady || !playerRef.current) return;

    const checkInterval = setInterval(() => {
      // Backgrounded tabs throttle the player into BUFFERING/UNSTARTED — counting that as a stall
      // would falsely flag an IP block. Same for the slow first-load before any track has played.
      if (document.hidden) return;
      if (!hasEverPlayedRef.current) return;
      // A buffering preview is not a stalled room track — don't force-load
      // the room track over it or report a false stall to the server.
      if (previewTrackRef.current) return;
      const state = playerRef.current.getPlayerState?.();
      if (state === YouTubeState.BUFFERING || state === YouTubeState.UNSTARTED) {
        stallRetriesRef.current += 1;
        if (import.meta.env.DEV) {
          console.warn(`[Player] Stall detected (Attempt ${stallRetriesRef.current}).`);
        }

        const stallLimit = deviceDetection.isTV() ? 6 : (isOwner ? 4 : 2);
        if (stallRetriesRef.current > stallLimit) {
          if (isOwner) {
            if (import.meta.env.DEV) {
              console.warn("[Player] Stall limit exceeded for owner. Reporting as playback error.");
            }
            sendMessage({
              type: "PLAYBACK_ERROR",
              payload: {
                videoId: currentTrackRef.current?.videoId,
                errorCode: 'stall'
              }
            });
          } else {
            // Guests just surface a local indicator; the overlay is driven by
            // NETWORK_THROTTLE and the stuck-deadline detector below, which
            // already escalates a guest-side total stuck condition.
            if (import.meta.env.DEV) {
              console.warn("[Player] Stall limit exceeded for guest. Surfacing local indicator.");
            }
            setPlaybackError(100);
          }
          clearInterval(checkInterval);
          return;
        }

        if (import.meta.env.DEV) {
          console.warn("[Player] Force-reloading video...");
        }
        const currentTime = playerRef.current.getCurrentTime?.() || progressRef.current;
        playerRef.current.loadVideoById?.(currentTrackRef.current?.videoId, currentTime);
      } else {
        if (state === YouTubeState.PLAYING) {
          stallRetriesRef.current = 0;
        }
      }
    }, 8000);

    return () => clearInterval(checkInterval);
  }, [isPlaying, isPlayerReady, isOwner, progressRef, sendMessage]);

  // The single, authoritative client-side detector: "the server says we're
  // supposed to be playing, but our local player hasn't fired a PLAYING
  // event for too long." Replaces the previous fan-out of fragile
  // accumulators (track-cycling counter, 101/150 video-set, stall-set
  // size>=2, first-play tick counter) — those each conflated different
  // things and traded false positives on slightly-flaky networks for
  // false negatives on never-plays-at-all networks (Tor "sign in to
  // confirm" being the canonical example).
  //
  // What this detector measures: time since lastSuccessfulPlayRef was
  // last refreshed. lastSuccessfulPlayRef is touched on mount, on
  // onReady, on every PLAYING state-change, on visibility-change-visible,
  // and on server-confirmed-unavailable VIDEO_STATUS messages. So the
  // window is "no PLAYING since the last reasonable anchor." If that
  // window exceeds STUCK_DEADLINE_MS while the server says we should
  // be playing and we're not currently in PLAYING state, we escalate:
  //   - Owner: send PLAYBACK_ERROR errorCode='stuck_on_load'. The
  //     server's API check decides — server-playable -> owner-IP-blocked
  //     -> NETWORK_THROTTLE broadcast; server-unplayable -> genuine skip.
  //   - Guest: fire the overlay locally. The server can't help when
  //     only the guest's network is the broken one (Tor private tab,
  //     restricted Wi-Fi, etc.).
  // stuckReportedRef debounces to one report per "stuck episode";
  // PLAYING resets it.
  useEffect(() => {
    if (!hasConsent) return;
    if (!currentTrack) return;
    if (!isPlayerReady) return;
    if (!isPlaying) return;
    if (isLocallyPaused) return;
    if (previewTrack) return;
    if (hasFullscreenOverlay) return;
    // Anchor refresh on activation: every time we transition into "supposed
    // to be playing" (after a pause / settings being open / a preview ending
    // / server-side pause-then-play), reset the anchor so the time the user
    // spent in the bailed-out state doesn't count toward the deadline. Real
    // genuinely-stuck cases still fire after STUCK_DEADLINE_MS from now.
    lastSuccessfulPlayRef.current = Date.now();
    stuckReportedRef.current = false;
    const interval = setInterval(() => {
      if (document.hidden) return;
      if (stuckReportedRef.current) return;
      const state = playerRef.current?.getPlayerState?.();
      if (
        state === YouTubeState.PLAYING
        || state === YouTubeState.CUED
        || state === YouTubeState.PAUSED
      ) {
        // PLAYING — the IFrame Player API can occasionally drop a PLAYING
        // state change on the floor (especially after iframe re-attachment).
        // If we're polling and see the player IS playing, refresh the
        // anchor ourselves so the deadline can't fire spuriously.
        //
        // CUED — the player loaded the video but the browser blocked
        // autoplay (iOS Safari, some embedded WebViews, strict media
        // policies). The user can fix this with one tap; it is NOT an IP
        // block. Firing the "playback restricted" overlay here would be
        // misleading, so treat CUED as a non-stuck state.
        //
        // PAUSED — by the time we reach the polling check, every "user
        // paused on purpose" path has already bailed out above (server
        // !isPlaying, isLocallyPaused, hasFullscreenOverlay, previewTrack).
        // What's left for the player to be PAUSED while the server says we
        // should be playing is browser interaction policy — unmuted-autoplay
        // blocked, an ad break, the OS audio session being preempted, etc.
        // None of those are IP blocks; firing the overlay would be wrong.
        lastSuccessfulPlayRef.current = Date.now();
        return;
      }
      const noPlayingFor = Date.now() - lastSuccessfulPlayRef.current;
      if (noPlayingFor < STUCK_DEADLINE_MS) return;
      if (import.meta.env.DEV) {
        console.warn(`[Player] Stuck — supposed to be playing, no PLAYING for ${Math.round(noPlayingFor / 1000)}s. State=${state}.`);
      }
      stuckReportedRef.current = true;
      if (isOwner) {
        sendMessage({
          type: "PLAYBACK_ERROR",
          payload: {
            videoId: currentTrackRef.current?.videoId,
            errorCode: 'stuck_on_load',
          },
        });
      } else if (!isThrottleDismissActive()) {
        setIpBlockDetected(true);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [hasConsent, currentTrack, isPlayerReady, isPlaying, isLocallyPaused, previewTrack, hasFullscreenOverlay, isOwner, sendMessage, isThrottleDismissActive]);

  // Progress bar update (polls ref to avoid re-renders from progress messages)
  useEffect(() => {
    if (!isPlayerReady) return;
    const update = () => {
      const duration = playerRef.current?.getDuration?.() || 0;
      if (duration > 0) {
        setProgress((progressRef.current / duration) * 100);
      } else {
        setProgress(0);
      }
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [isPlayerReady, progressRef]);

  // The same progress bar for the host's Apple Music player.
  const appleStatus = apple.status;
  const getAppleDuration = apple.getDuration;
  useEffect(() => {
    if (appleStatus !== 'ready') return;
    const update = () => {
      const duration = getAppleDuration() || currentTrackRef.current?.duration || 0;
      setProgress(duration > 0 ? Math.min(100, (progressRef.current / duration) * 100) : 0);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [appleStatus, getAppleDuration, progressRef]);

  // Event Handlers

  const handlePlayPause = () => {
    const isEffectivelyPlaying = (isPlaying || isLocallyPlaying) && !isLocallyPaused;

    if (isOwner) {
      // Owner controls global state based on what THEY see (effective state)
      // If effective state is playing, we send PAUSE.
      // If effective state is paused, we send PLAY.
      sendMessage({ type: "PLAY_PAUSE", payload: !isEffectivelyPlaying });

      // Reset local overrides to resync with the new server state we just requested
      setIsLocallyPaused(false);
      setIsLocallyPlaying(false);
    } else {
      // Guest: Local Toggle Only
      if (isEffectivelyPlaying) {
        // User wants to PAUSE
        setIsLocallyPaused(true);
        setIsLocallyPlaying(false);
        playerRef.current?.pauseVideo?.();
      } else {
        // User wants to PLAY
        setIsLocallyPaused(false);
        setIsLocallyPlaying(true);
        playerRef.current?.playVideo?.();
      }
    }
  };



  const handleMuteToggle = () => {

    if (isMuted) playerRef.current?.unMute?.();

    else playerRef.current?.mute?.();

    setIsMuted(!isMuted);

  };



  const handleVolumeChange = (e) => {

    const newVolume = Number(e.target.value);

    setVolume(newVolume);

    if (playerRef.current) {

      playerRef.current.setVolume?.(newVolume);

      if (isMuted) {

        playerRef.current.unMute?.();

        setIsMuted(false);

      }

    }

  };



  const handleSongSuggested = useCallback((query) => {
    if (!canParticipate(user, requireLogin)) {
      setToast({ message: t(user ? 'errors.loginRequired' : 'errors.sessionNotReady'), type: 'error' });
      return;
    }
    sendMessage({ type: "SUGGEST_SONG", payload: { query, userId: user?.id } });
  }, [user, requireLogin, sendMessage, t]);

  const handleLibraryAdd = useCallback((videoId) => {
    // Re-suggest by link, which the server resolves without a search. Apple
    // links carry a storefront in the path; the server uses the host's.
    const key = parseTrackKey(videoId);
    if (key?.provider === 'apple') {
      const type = key.kind === 'musicVideo' ? 'music-video' : 'song';
      return handleSongSuggested(`https://music.apple.com/us/${type}/${key.id}`);
    }
    return handleSongSuggested(`https://www.youtube.com/watch?v=${videoId}`);
  }, [handleSongSuggested]);

  const handleRemoveFromLibrary = useCallback((videoId) => {
    if (import.meta.env.DEV) {
      console.log("[App] Removing from Library:", videoId);
    }
    sendMessage({ type: "REMOVE_FROM_LIBRARY", payload: { videoId } });
  }, [sendMessage]);

  const handleFetchSuggestions = useCallback((track) => {
    // Toggle if clicking same track
    if (activeSuggestionId === track.id) {
      setActiveSuggestionId(null);
      return;
    }

    if (import.meta.env.DEV) {
      console.log("[App] handleFetchSuggestions triggered for:", track.title);
    }
    setActiveSuggestionId(track.id);
    setManualSuggestions([]); // Clear previous
    setIsFetchingSuggestions(true);

    sendMessage({
      type: "FETCH_SUGGESTIONS",
      // videoId only — the server resolves title/artist from the room's own
      // tracks. Sending them from here would hand the caller both the cache key
      // and the search term.
      payload: { videoId: track.videoId }
    });
  }, [activeSuggestionId, sendMessage]);





  const handleVote = (trackId, type) => {
    // The server enforces this too; checking here turns a rejected vote into an
    // explanation of the room's rule.
    if (!canParticipate(user, requireLogin)) {
      setToast({ message: t(user ? 'errors.loginRequired' : 'errors.sessionNotReady'), type: 'error' });
      return;
    }
    sendMessage({ type: "VOTE", payload: { trackId, voteType: type } });
  };




  const handlePreviewTrack = useCallback((track) => {
    setIsLocallyPaused(true);
    setPreviewTrack(track);
  }, []);



  const handleUpdateSettings = (settings) => {
    sendMessage({ type: "UPDATE_SETTINGS", payload: settings });
  };

  const handleStopPreview = useCallback(() => {
    setPreviewTrack(null);
    setIsLocallyPaused(false);
    playerRef.current?.seekTo?.(progressRef.current);
  }, [progressRef]);

  // Watch for Room Not Found Error
  useEffect(() => {
    if (lastMessage && lastMessage.type === "error" && lastMessage.code === "ROOM_NOT_FOUND") {
      setRoomNotFound(true);
    }
  }, [lastMessage]);

  // Reset error when changing rooms
  useEffect(() => {
    setRoomNotFound(false);
  }, [activeRoomId]);

  const handleDeleteSong = (trackId) => {
    sendMessage({ type: "DELETE_SONG", payload: { trackId } });
  };

  const handleSeek = (percentage) => {
    if (isAppleRoom) {
      const duration = apple.getDuration() || currentTrack?.duration || 0;
      if (!isOwner || !duration) return;
      const seconds = (percentage / 100) * duration;
      sendMessage({ type: "SEEK_TO", payload: seconds });
      apple.seek(seconds);
      return;
    }
    if (!playerRef.current) return;
    const duration = playerRef.current.getDuration();
    if (!duration) return;
    const seconds = (percentage / 100) * duration;
    if (isOwner) {
      sendMessage({ type: "SEEK_TO", payload: seconds });
      playerRef.current.seekTo(seconds, true);
    }
  };

  if (roomNotFound) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4">
        <h2 className="text-3xl font-bold text-red-500 mb-4">{t('app.channelNotFound')}</h2>
        <p className="text-neutral-400 mb-8">{t('app.notFoundMessage', { roomId: activeRoomId })}</p>
        <button
          onClick={() => navigate("/")}
          className="px-6 py-3 rounded-full bg-neutral-800 hover:bg-neutral-700 text-white font-semibold transition-colors flex items-center gap-2"
        >
          <ArrowLeft size={20} /> {t('app.goToLobby')}
        </button>
      </div>
    );
  }

  // TOS Compliance: Window Size Blocker (Desktop only, if not blocked by mobile check)
  if (isWindowTooSmall && !deviceDetection.isTV()) {
    return (
      <div className="flex flex-col h-screen w-full bg-black items-center justify-center p-6 text-center z-[100] relative overflow-hidden">
        <div className="absolute inset-0 bg-neutral-900/50" />
        <div className="relative z-10 max-w-sm space-y-6">
          <div className="mx-auto w-16 h-16 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-500 animate-bounce">
            <Maximize2 size={32} />
          </div>
          <h2 className="text-2xl font-bold text-white">{t('app.windowTooSmall')}</h2>
          <p className="text-neutral-400">
            {t('app.windowTooSmallMessage')}
          </p>
        </div>
      </div>
    );
  }



  // DEBUG OVERLAY (Temporary)
  // Ensure we can see what the phone thinks it is
  /*
  const showDebug = true; 
  if (showDebug) {
    return (
        <>
            <div style={{position:'fixed', top:0, left: 0, right:0, zIndex: 9999, background: 'rgba(255,0,0,0.8)', color: 'white', padding: '10px', fontSize: '10px', wordBreak: 'break-all'}}>
                UA: {userAgent} <br/>
                Android: {isAndroid.toString()} | TV: {isTV().toString()} | Wrapper: {isWrapper.toString()}
            </div>
            { 
               // Standard render below... 
            }
        </>
    )
  }
  */
  // actually, let's remove the previous react-based debug overlay to avoid confusion
  /* 
  const debugOverlay = ... 
  */



  // The viewer's own votes. The server marks them per recipient as `myVote` —
  // the full voters map is no longer broadcast, since it is keyed by Google
  // account id. (The old lookup here read voters[clientId], but clientId is a
  // browser-local UUID and never matched, so no highlight ever showed.)
  const userVotes = {};
  queue.forEach(track => {
    if (track.myVote) userVotes[track.id] = track.myVote;
  });
  if (currentTrack && currentTrack.myVote) {
    userVotes[currentTrack.id] = currentTrack.myVote;
  }

  const passwordModalContent = showPasswordModal ? (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Lock size={20} className="text-orange-500" /> {t('app.privateChannel')}
          </h3>
          <button onClick={() => navigate('/')} className="text-neutral-500 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="mb-4 text-neutral-400 text-sm">
          {t('app.lockedMessage')}
        </div>

        <form onSubmit={submitPasswordJoin} className="space-y-4">
          <div>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder={t('lobby.passwordInputPlaceholder')}
              className={`w-full bg-[#050505] border ${passwordError ? 'border-red-500 focus:border-red-500' : 'border-neutral-800 focus:border-orange-500'} rounded-xl px-4 py-3 text-white focus:outline-none transition-colors`}
              autoFocus
            />
            {passwordError && (
              <div className="text-red-500 text-sm mt-2 font-medium animate-in slide-in-from-top-1">
                {passwordError}
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="flex-1 px-4 py-3 rounded-xl border border-neutral-700 text-neutral-300 font-medium hover:bg-neutral-800 transition-all"
            >
              {t('lobby.cancel')}
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 text-white font-bold hover:from-orange-400 hover:to-orange-500 transition-all"
            >
              {t('app.unlock')}
            </button>
          </div>
        </form>
      </div>
    </div>
  ) : null;

  if ((!serverState || isStaleState)) {
    return (
      <>
        <LoadingScreen isOnline={isOnline} isConnected={isConnected} reconnectAttempt={reconnectAttempt} onForceReconnect={forceReconnect} />
        {passwordModalContent}
      </>
    );
  }


  // NOTE: handleDeleteSong and handleSeek are now defined before the early return (see above)

  // SettingsView is rendered as a fixed overlay near the bottom of the JSX so the
  // YouTube IFrame stays mounted during settings navigation. Destroying and
  // recreating it on every settings open/close caused the iframe to come back
  // empty whenever a track changed during the brief reinit window.



  const showThrottleBar = networkThrottle && !ipBlockDetected && !throttleDismissed;

  // Whoever came in with only the YouTube consent learns here, once the room
  // says it plays Apple Music, what this channel loads from Apple.
  if (isAppleRoom && !hasAppleConsent) {
    return <JoinWelcome provider="apple" onAccept={giveAppleConsent} />;
  }

  return (
    <div
      className={`text-white flex flex-col ${isAnyPlaylistView ? "h-[100dvh] h-screen overflow-hidden bg-[#0a0a0a] pb-0" : (isQueueMinimized && !isCinemaMode ? "h-[100dvh] h-screen overflow-hidden bg-black" : "min-h-screen bg-black pb-32")}`}
      style={isQueueMinimized && !isCinemaMode && !isAnyPlaylistView ? { paddingBottom: `${controlsHeight}px` } : undefined}
    >
      {ipBlockDetected && !throttleDismissed && (
        <div className="fixed inset-0 z-[100] bg-[#050505] text-white flex items-center justify-center p-6 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-red-900/20 via-[#050505] to-[#050505] pointer-events-none" />
          <div className="relative z-10 w-full flex flex-col items-center justify-center text-center max-w-md animate-in fade-in zoom-in-95 duration-500">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-6">
              <WifiOff size={32} className="text-red-400" />
            </div>
            <h2 className="text-2xl md:text-3xl font-bold text-white mb-3 tracking-tight">
              {t('player.ipBlockTitle', 'Unable to play on this network')}
            </h2>
            <p className="text-neutral-400 font-medium mb-4 leading-relaxed text-balance">
              {t('player.ipBlockMessage', "YouTube is restricting video playback on your current network. Try switching to mobile data or a different Wi-Fi network.")}
            </p>
            <div className="flex items-center justify-center gap-2 text-sm text-neutral-500 mb-8 bg-neutral-900/80 border border-neutral-800 rounded-lg px-4 py-2">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500 shrink-0" />
              <span>{t('player.ipBlockYouTubeStatus', 'youtube.com — Playback restricted')}</span>
            </div>
            <div className="flex gap-3 w-full">
              <button
                autoFocus
                onClick={() => window.location.reload()}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white font-bold text-lg shadow-lg hover:shadow-orange-500/20 hover:scale-[1.02] active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-[#050505]"
              >
                <RefreshCw size={18} />
                {t('player.ipBlockRetry', 'Reload')}
              </button>
              <button
                onClick={() => { dismissThrottle(); setIpBlockDetected(false); }}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-medium transition-all focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-[#050505]"
              >
                {t('player.ipBlockDismiss', 'Dismiss')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReconnectBanner && serverState && !isStaleState && (
        <div className={`fixed top-0 left-0 right-0 z-[100] ${!isOnline ? 'bg-red-600/95' : 'bg-orange-600/95'} backdrop-blur-sm text-white text-center py-1.5 text-xs font-medium`}>
          <div className="flex items-center justify-center gap-2">
            {!isOnline ? (
              <>
                <WifiOff size={12} />
                <span>{t('app.noInternet', 'No Internet Connection')}</span>
              </>
            ) : (
              <>
                <RefreshCw size={12} className="animate-spin" />
                <span>{t('app.reconnecting', 'Reconnecting')}...</span>
              </>
            )}
            {reconnectAttempt > 3 && (
              <button
                onClick={forceReconnect}
                className="ml-1 px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 transition-colors"
              >
                {t('app.retry', 'Retry')}
              </button>
            )}
          </div>
        </div>
      )}
      {!isCinemaMode && (
        <div className="sticky top-0 z-[55] bg-[#050505]/95 backdrop-blur-md border-b border-neutral-900 transition-all duration-700 ease-in-out">
          <Header
            showYouTubeAttribution={!isAppleRoom}
            onGoHome={() => navigate("/")}
            onShowSuggest={setShowSuggest}
            user={user}
            onLoginSuccess={handleLoginSuccess}
            onLogout={handleLogout}
            onDeleteAccount={handleDeleteAccount}
            isOwner={isOwner}
            showQRCode={showQRModal}
            onShowQRCode={setShowQRModal}
            showSettings={showSettings}
            onToggleSettings={() => {
              setShowSettings(!showSettings);
              if (!showSettings) setShowSuggest(false);
            }}
            onCloseSettings={() => setShowSettings(false)}
            mode={isAnyPlaylistView ? playlistActiveTab : "default"}
            onPlaylist={() => {
              if (isAnyPlaylistView) {
                setPlaylistActiveTab("playlist");
              } else {
                setLocalPlaylistView(true);
                setPlaylistActiveTab("playlist");
                setShowSettings(false);
                setShowSuggest(false);
              }
            }}
            onLibrary={() => setPlaylistActiveTab("library")}
            onSuggest={() => {
              setShowSuggest(prev => !prev);
              setShowSettings(false);
            }}
            onShare={() => {
              setShowQRModal(true);
              setShowSettings(false);
              setShowSuggest(false);
            }}
            onClosePlaylist={localPlaylistView ? () => {
              setLocalPlaylistView(false);
              setPlaylistActiveTab("playlist");
            } : null}
            showSuggest={showSuggest}
            suggestionsEnabled={suggestionsEnabled}
            ownerBypass={ownerBypass}
            playlistViewMode={playlistViewMode}
            onFullscreenOverlay={setHeaderOverlay}
          />
          {showThrottleBar && (
            <div className="bg-yellow-600/95 text-white text-center py-1.5 text-xs font-medium">
              <div className="flex items-center justify-center gap-2 px-2">
                <AlertTriangle size={12} className="shrink-0" />
                <span className="truncate">{t('app.networkThrottle', "YouTube has blocked this network's IP. Playback paused. Try switching to a mobile hotspot.")}</span>
                {isOwner && (
                  <button
                    onClick={() => { clearThrottleDismiss(); setNetworkThrottle(null); sendMessage({ type: "PLAY_PAUSE", payload: true }); }}
                    className="shrink-0 px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 transition-colors"
                  >
                    {t('app.retryPlayback', 'Retry')}
                  </button>
                )}
                <button
                  onClick={dismissThrottle}
                  className="shrink-0 p-0.5 rounded hover:bg-white/20 transition-colors"
                  aria-label="Dismiss"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}
          {showSuggest && (
            <div className="px-4 pb-3">
              <SuggestSongForm
                onSongSuggested={handleSongSuggested}
                onShowSuggest={setShowSuggest}
                serverError={participationErrorKey(lastErrorCode) ? t(participationErrorKey(lastErrorCode)) : lastError}
                serverMessage={lastMessage}
                isOwner={isOwner && ownerBypass}
                suggestionsEnabled={suggestionsEnabled}
                suggestionMode={suggestionMode}
                isConnected={isConnected}
                currentTrack={currentTrack}
                onRecommend={isAppleRoom ? undefined : handleFetchSuggestions}
                suggestions={manualSuggestions}
                isFetchingSuggestions={isFetchingSuggestions}
                queueVideoIds={queueVideoIds}
              />
            </div>
          )}
        </div>
      )}

      {isOwner && pendingSuggestions.length > 0 && ownerPopups && (() => {
        const PendingRequests = pendingRequestsExports?.PendingRequests;
        return PendingRequests ? (
          <PendingRequests
            requests={pendingSuggestions}
            onApprove={handleApproveSuggestion}
            onReject={handleRejectSuggestion}
            onBan={handleBanSuggestion}
            onPreview={isAppleRoom ? undefined : handlePreviewTrack}
            onClose={() => handleUpdateSettings({ ownerPopups: false })}
          />
        ) : null;
      })()}

      {showPendingPage && (() => {
        const PendingRequestsPage = pendingRequestsExports?.PendingRequestsPage;
        return PendingRequestsPage ? (
          <PendingRequestsPage
            requests={pendingSuggestions}
            onApprove={handleApproveSuggestion}
            onReject={handleRejectSuggestion}
            onBan={handleBanSuggestion}
            onManageBanned={() => setShowBannedPage(true)}
            onPreview={isAppleRoom ? undefined : handlePreviewTrack}
            onClose={() => setShowPendingPage(false)}
          />
        ) : null;
      })()}

      {showPendingPage && previewTrack && (
        <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-8 animate-fadeIn">
          <div className="w-full max-w-5xl aspect-video bg-black rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10 relative">
            <PlayerErrorBoundary>
              {hasConsent ? (
                playbackError ? (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-neutral-900 text-center p-6 space-y-4">
                    <div className="w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center text-neutral-400">
                      <AlertTriangle size={24} />
                    </div>
                    <div>
                      <p className="text-white font-medium mb-1">
                        {playbackError === 100 ? t('player.errorNotFound') : (playbackError === 101 || playbackError === 150 ? t('player.errorRestricted') : t('player.errorGeneric'))}
                      </p>
                    </div>
                  </div>
                ) : (
                  <Player
                    playerContainerRef={playerContainerRef}
                  />
                )
              ) : (CookieBlockedPlaceholderComponent ? <CookieBlockedPlaceholderComponent player={isAppleRoom ? 'apple' : 'youtube'} /> : <div className="w-full h-full flex items-center justify-center bg-black text-neutral-500">Loading…</div>)}
            </PlayerErrorBoundary>
          </div>
        </div>
      )}

      {showBannedPage && (
        <BannedVideosPage
          bannedVideos={bannedVideos}
          onUnban={handleUnbanSong}
          onClose={() => setShowBannedPage(false)}
        />
      )}



      <div
        className={isCinemaMode
          ? "fixed inset-0 z-40 bg-black transition-all duration-500 ease-in-out"
          : (isAnyPlaylistView
            ? "flex-1 w-full relative group transition-all duration-500 ease-in-out min-h-0"
            : `w-full relative group transition-all duration-500 ease-in-out min-w-[200px] min-h-[200px] ${isQueueMinimized ? "flex-1 min-h-0" : "flex-shrink-0 aspect-video max-h-[60vh]"}`
          )
        }
        style={{
          bottom: (isCinemaMode && controlsVisible) ? `${controlsHeight}px` : "0px",
          ...(!isCinemaMode && !isAnyPlaylistView && !isQueueMinimized && showThrottleBar
            ? { maxHeight: 'calc(60vh - 1.75rem)' }
            : {})
        }}
      >
        <div
          className={`absolute inset-0 border-4 ${previewTrack ? "border-green-500" : "border-transparent"} transition-colors duration-300 box-border pointer-events-none z-20`}
        ></div>
        {isAnyPlaylistView ? (
          /* Venue Mode: Only Playlist View */
          <div className="w-full h-full flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 overflow-hidden">
            <PlaylistView
              history={history}
              currentTrack={currentTrack}
              queue={queue} // Pass full queue
              user={user}
              onVote={handleVote}
              votes={userVotes} // Pass userVotes map
              isOwner={isOwner}
              // Playback Props
              progress={progress}
              volume={volume}
              isMuted={isMuted}
              activeChannel={activeChannel}
              onMuteToggle={handleMuteToggle}
              onVolumeChange={handleVolumeChange}
              votesEnabled={serverState?.votesEnabled ?? true}
              onPreview={prelistenEnabled ? handlePreviewTrack : null}
              onDelete={isOwner ? handleDeleteSong : null}
              onRecommend={isAppleRoom ? undefined : handleFetchSuggestions} // Passed handler
              onAdd={handleLibraryAdd}
              // Suggestions Props
              activeSuggestionId={activeSuggestionId}
              suggestions={manualSuggestions}
              isFetchingSuggestions={isFetchingSuggestions}
              queueVideoIds={queueVideoIds}
              disableFloatingUI={!!previewTrack}
              onLibraryDelete={isOwner ? handleRemoveFromLibrary : undefined}
              activeTab={playlistActiveTab}
              appFooterPresent={showAppFooter}
            />
            </div>
            {showAppFooter && <AppPromoFooter />}
            {previewTrack && (
              <PrelistenOverlay
                hasConsent={hasConsent}
                playbackError={playbackError}
                playerContainerRef={playerContainerRef}
                isCinemaMode={isCinemaMode}
                t={t}
              />
            )}
          </div>
        ) : (
          /* Standard Mode */
          <>
            {!showPendingPage && !showBannedPage && (
              <div className="absolute inset-0">
                {!playerConsent ? (
                  CookieBlockedPlaceholderComponent ? <CookieBlockedPlaceholderComponent player={isAppleRoom ? 'apple' : 'youtube'} /> : <div className="w-full h-full flex items-center justify-center bg-black text-neutral-500">Loading…</div>
                ) : (
                  <>
                    <div style={{ display: (currentTrack || previewTrack) ? 'block' : 'none', width: '100%', height: '100%' }}>
                      <PlayerErrorBoundary>
                        {isAppleRoom ? (
                          <AppleMusicHostPlayer apple={apple} currentTrack={currentTrack} />
                        ) : playbackError ? (
                          <div className="w-full h-full flex flex-col items-center justify-center bg-neutral-900 text-center p-6 space-y-4">
                            <div className="w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center text-neutral-400">
                              <AlertTriangle size={24} />
                            </div>
                            <div>
                              <p className="text-white font-medium mb-1">
                                {playbackError === 100 ? t('player.errorNotFound') : (playbackError === 101 || playbackError === 150 ? t('player.errorRestricted') : t('player.errorGeneric'))}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <Player
                            playerContainerRef={playerContainerRef}
                          />
                        )}
                      </PlayerErrorBoundary>
                    </div>
                    {!(currentTrack || previewTrack) && <div className="flex h-full w-full items-center justify-center text-neutral-500 bg-neutral-900">{t('playlist.queueEmpty')}</div>}
                  </>
                )}
              </div>
            )}

          </>
        )}
      </div>

      {!isAnyPlaylistView && !isCinemaMode && (
        <div className={`min-h-0 transition-all duration-700 ease-in-out ${isQueueMinimized ? "flex-none" : "pb-4 flex-1"}`}>
          <Queue
            tracks={queue}
            currentTrack={currentTrack}
            expandedTrackId={expandedTrackId}
            votes={userVotes}
            onVote={handleVote}
            onToggleExpand={(trackId) => setExpandedTrackId(prev => prev === trackId ? null : trackId)}
            isMinimized={isQueueMinimized}
            onPreview={prelistenEnabled ? handlePreviewTrack : null}
            votesEnabled={serverState?.votesEnabled ?? true}
            onDelete={isOwner ? handleDeleteSong : null}
            onRecommend={isAppleRoom ? undefined : handleFetchSuggestions}
            onAdd={handleLibraryAdd}
            activeSuggestionId={activeSuggestionId}
            suggestions={manualSuggestions}
            isFetchingSuggestions={isFetchingSuggestions}
            queueVideoIds={queueVideoIds}
          />
        </div>
      )}

      {
        previewTrack ? (
          <div className="fixed bottom-0 left-0 w-full bg-green-900/95 backdrop-blur-md border-t border-green-700 px-3 py-2 sm:px-6 sm:py-3 flex items-center justify-between z-[80] select-none">
            <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
              <button
                onClick={handleStopPreview}
                className="bg-white text-green-900 hover:bg-gray-100 transition-colors rounded-full p-2 sm:p-3 shadow-lg flex-shrink-0 flex items-center gap-2"
                title={t('app.backToRadio')}
              >
                <ArrowLeft size={18} className="sm:w-6 sm:h-6" />
                <span className="font-bold pr-2 hidden sm:inline">{t('app.backToRadio')}</span>
              </button>
              <div className="truncate min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {previewTrack.title ? (
                    <h3 className="font-bold text-white text-sm sm:text-base leading-tight truncate">{previewTrack.title}</h3>
                  ) : (
                    <Skeleton className="h-4 w-32 max-w-full bg-green-700/60" />
                  )}
                  <span className="bg-green-500 text-black px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-bold animate-pulse flex-shrink-0">PREVIEW</span>
                </div>
                {previewTrack.artist ? (
                  <p className="text-green-200 text-xs sm:text-sm truncate">{previewTrack.artist}</p>
                ) : (
                  <Skeleton className="h-3 w-20 max-w-full mt-1 bg-green-700/50" />
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 text-green-200 pl-2 sm:pl-4 flex-shrink-0">
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  handleMuteToggle();
                }}
                className="hover:text-white transition-colors"
              >
                {isMuted ? <VolumeX /> : <Volume2 />}
              </button>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={volume}
                onChange={handleVolumeChange}
                className={`accent-green-500 w-24 ${isMuted ? "opacity-50" : ""} `}
                onClick={(event) => event.stopPropagation()}
              />
            </div>
          </div>
        ) : (
          !isAnyPlaylistView && !showPendingPage && playerConsent && (
            <PlaybackControls
              isPlaying={(isPlaying || isLocallyPlaying) && !isLocallyPaused}
              onPlayPause={handlePlayPause}
              progress={progress}
              currentTrack={currentTrack}
              activeChannel={activeChannel}
              isMuted={isMuted}
              onMuteToggle={handleMuteToggle}
              volume={volume}
              onVolumeChange={handleVolumeChange}
              isQueueMinimized={isQueueMinimized}
              onQueueToggle={() => setIsQueueMinimized(prev => !prev)}
              upcomingCount={upcomingCount}
              isCinemaMode={isCinemaMode}
              onToggleCinemaMode={() => setIsCinemaMode(!isCinemaMode)}
              onVisibilityChange={handleVisibilityChange}
              isOwner={isOwner}
              onSeek={handleSeek}
              onHeightChange={handleControlsHeightChange}
              canShowControls={canShowControls}
            />
          )
        )
      }
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
      {showSettings && (
        <div className="fixed inset-0 z-[200] w-full h-screen bg-[#1a1a1a] text-white overflow-hidden">
          <SettingsView
            onClose={() => setShowSettings(false)}
            pendingCount={pendingSuggestions.length}
            suggestionMode={suggestionMode}
            onManageRequests={() => {
              setShowPendingPage(true);
              setShowSettings(false);
            }}
            onUpdateSettings={handleUpdateSettings}
            suggestionsEnabled={suggestionsEnabled}
            autoApproveKnown={autoApproveKnown}
            musicOnly={musicOnly}
            maxDuration={maxDuration}
            maxQueueSize={maxQueueSize}
            duplicateCooldown={duplicateCooldown}
            smartQueue={smartQueue}
            autoRefill={autoRefill}
            requireLogin={requireLogin}
            playlistViewMode={playlistViewMode}
            allowPrelisten={allowPrelisten}
            votesEnabled={serverState?.votesEnabled ?? true}
            ownerBypass={ownerBypass}
            ownerQueueBypass={serverState?.ownerQueueBypass}
            ownerPopups={ownerPopups}
            onDeleteChannel={handleDeleteChannel}
            captionsEnabled={captionsEnabled}
            isConnected={isConnected}
            onFullscreenOverlay={setSettingsOverlay}
          />
        </div>
      )}

      {/* TV Unmute Overlay - only when video is visible (not in playlist-only view) */}
      {deviceDetection.isTV() && isMuted && isPlayerReady && !isAnyPlaylistView && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-500">
          <button
            onClick={() => {
              handleMuteToggle();
              const isEffectivelyPlaying = (isPlaying || isLocallyPlaying) && !isLocallyPaused;
              if (!isEffectivelyPlaying) {
                handlePlayPause();
              }
            }}
            className="group relative bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-full px-12 py-6 text-3xl font-bold flex items-center gap-6 shadow-2xl hover:from-orange-400 hover:to-orange-500 hover:scale-105 transition-all duration-300"
          >
            <div className="absolute inset-0 rounded-full bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            <VolumeX size={48} className="animate-pulse" />
            {t('app.tapToUnmute')}
            <div className="absolute -inset-4 rounded-full border border-white/20 animate-ping opacity-20" />
            <div className="absolute -inset-8 rounded-full border border-white/10 animate-ping opacity-10 animation-delay-300" />
          </button>
        </div>
      )}

    </div>
  );
}
export default RoomBody;
