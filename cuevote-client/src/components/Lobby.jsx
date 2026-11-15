// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, Link } from "react-router-dom";
import { Users, Sparkles, Cookie, UserRound, AlertCircle, X, LogOut, Search, Lock, Globe, Scale, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { useWebSocketContext } from "../hooks/useWebSocketContext";
import { Consent } from '../contexts/ConsentContext';
import { Language } from '../contexts/LanguageContext';
import { dangerousHtml } from '../utils/sanitizeHtml';
import { LanguageSwitcherExports } from './LanguageSwitcher';
const { LanguageSwitcher, languages } = LanguageSwitcherExports;
import { GoogleAuthButton } from './GoogleAuthButton';
import { GoogleGIcon } from './GoogleGIcon';
import { YouTubeBrandSubtitle } from './YouTubeBrandSubtitle';
import { channelLanguages, getFlagEmoji, hasFlag } from '../constants/channelLanguages';
import { formatCount } from '../utils/numbers';
import { Avatar } from './Avatar';

import { LoadingScreen } from './LoadingScreen';
import { SegmentedControl } from './SegmentedControl';
import { displayName, isSignedIn } from '../utils/participation';
import { DEVELOPER_TOKEN_URL } from '../utils/musicKit';
import { deviceDetection } from '../utils/deviceDetection';

function useLocalizedCountries(uiLanguage) {
    return useMemo(() => {
        const displayNames = new Intl.DisplayNames([uiLanguage, 'en'], { type: 'region' });
        const enDisplayNames = new Intl.DisplayNames(['en'], { type: 'region' });
        return channelLanguages.map(lang => {
            if (lang.code === 'international') {
                return { ...lang, label: 'International', search: 'international' };
            }
            const localized = displayNames.of(lang.code) || lang.code;
            const english = enDisplayNames.of(lang.code) || lang.code;
            return {
                ...lang,
                label: localized,
                search: `${localized}\t${english}`.toLowerCase(),
            };
        });
    }, [uiLanguage]);
}

export function Lobby() {
    const navigate = useNavigate();
    const { sendMessage, lastMessage, isConnected, lastError, lastErrorCode, user, handleLoginSuccess, handleLogout, clearMessage, state, reconnectAttempt, forceReconnect } = useWebSocketContext();
    const { hasConsent, showBanner } = Consent.useConsent();
    const { t, language, setLanguage } = Language.useLanguage();
    const localizedCountries = useLocalizedCountries(language);
    const [rooms, setRooms] = useState([]);
    const [failedThumbnails, setFailedThumbnails] = useState(new Set());

    const [isOnline, setIsOnline] = useState(navigator.onLine);
    useEffect(() => {
        const update = () => setIsOnline(navigator.onLine);
        window.addEventListener('online', update);
        window.addEventListener('offline', update);
        return () => {
            window.removeEventListener('online', update);
            window.removeEventListener('offline', update);
        };
    }, []);

    // Debounce the LoadingScreen — brief mobile disconnects (< 2.5 s) shouldn't flash the overlay
    // and steal the rooms grid mid-scroll. A page that opens without a connection shows it at
    // once; coming back from a channel the connection is there, and so is the grid.
    const [showConnectingOverlay, setShowConnectingOverlay] = useState(!isConnected);
    useEffect(() => {
        if (isConnected) {
            setShowConnectingOverlay(false);
            return;
        }
        const timer = setTimeout(() => setShowConnectingOverlay(true), 2500);
        return () => clearTimeout(timer);
    }, [isConnected]);

    // The placeholders stay until the first list is there, so they hand over to
    // the channels and not to an empty grid. A server that does not answer
    // gets the grid anyway.
    const [hasList, setHasList] = useState(false);
    useEffect(() => {
        if (!isConnected || hasList) return undefined;
        const timer = setTimeout(() => setHasList(true), 4000);
        return () => clearTimeout(timer);
    }, [isConnected, hasList]);

    // Native Bridge: Sync QR Button State (LOBBY ONLY)
    useEffect(() => {
        // Show QR only if user has consented AND no banner is shown (implicit Lobby because this component IS valid)
        const showQR = !!(hasConsent && !showBanner);

        const sendBridgeMessage = () => {
            // iOS Bridge
            if (window.webkit?.messageHandlers?.toggleQRButton) {
                window.webkit.messageHandlers.toggleQRButton.postMessage(showQR);
            }
            // Android Bridge
            if (window.CueVoteAndroid?.toggleQRButton) {
                window.CueVoteAndroid.toggleQRButton(showQR);
            }
        };

        // Send immediately
        sendBridgeMessage();

        // Retry mechanics
        const t1 = setTimeout(sendBridgeMessage, 500);
        const t2 = setTimeout(sendBridgeMessage, 1500);
        const t3 = setTimeout(sendBridgeMessage, 3000);

        return () => {
            // Cleanup: Hide button when leaving Lobby
            if (window.webkit?.messageHandlers?.toggleQRButton) window.webkit.messageHandlers.toggleQRButton.postMessage(false);
            if (window.CueVoteAndroid?.toggleQRButton) window.CueVoteAndroid.toggleQRButton(false);

            clearTimeout(t1);
            clearTimeout(t2);
            clearTimeout(t3);
        };
    }, [hasConsent, showBanner]);



    // TV Auto-Redirect - DISABLED so user sees Lobby first
    /*
    useEffect(() => {
        if (isTV() && rooms.length > 0) {
            const tvRoom = rooms.find(r => r.name === "TV") || rooms.find(r => r.id === "tv-a56dfad8") || rooms[0];
            if (tvRoom) {
                console.log("[Lobby] TV Detected. Auto-joining:", tvRoom.name);
                navigate(`/room/${tvRoom.id}`);
            }
        }
    }, [rooms, navigate]);
    */

    // Creation State
    const [isCreatingRoom, setIsCreatingRoom] = useState(false);
    const [newRoomName, setNewRoomName] = useState("");
    const [isPrivate, setIsPrivate] = useState(true);
    const [createPassword, setCreatePassword] = useState("");
    const [languageFlag, setLanguageFlag] = useState('international');
    const [languageFlagOpen, setLanguageFlagOpen] = useState(false);
    const [createFlagSearch, setCreateFlagSearch] = useState("");
    const [provider, setProvider] = useState('youtube');
    const [appleMusicAvailable, setAppleMusicAvailable] = useState(false);

    // Apple Music rooms exist only where the server has a MusicKit key. Its token
    // route answers JSON then; anything else (404, an HTML fallback) means no.
    useEffect(() => {
        if (!isCreatingRoom || appleMusicAvailable) return undefined;
        let cancelled = false;
        fetch(DEVELOPER_TOKEN_URL, { method: 'HEAD', cache: 'no-store' })
            .then((res) => {
                const isJson = (res.headers.get('content-type') || '').includes('application/json');
                if (!cancelled) setAppleMusicAvailable(res.ok && isJson);
            })
            .catch(() => { /* stays YouTube-only */ });
        return () => { cancelled = true; };
    }, [isCreatingRoom, appleMusicAvailable]);

    // Joining State (Password)
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [passwordRoomId, setPasswordRoomId] = useState(null);
    const [passwordInput, setPasswordInput] = useState("");
    const [passwordError, setPasswordError] = useState("");

    // Profile Modal State (GDPR)
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteConfirmationText, setDeleteConfirmationText] = useState("");

    // View State
    const [channelType, setChannelType] = useState('public'); // 'public' | 'private'
    const [focusedIndex, setFocusedIndex] = useState(0);
    // The focus ring belongs to the arrow keys (a TV remote, a keyboard). With a
    // mouse or a finger the card under it is marked by its hover and pressed
    // looks, and nothing is ringed before anyone has pointed at anything.
    const [keyboardFocus, setKeyboardFocus] = useState(() => deviceDetection.isTV());
    const [columns, setColumns] = useState(4);
    const isScrolling = useRef(false);
    // Default to 4 for lg screens
    const [searchQuery, setSearchQuery] = useState("");
    const [filterLanguageFlag, setFilterLanguageFlag] = useState('international');
    const [filterFlagOpen, setFilterFlagOpen] = useState(false);
    const [filterFlagSearch, setFilterFlagSearch] = useState("");
    const filterFlagRef = useRef(null);

    // Keyboard Navigation State
    const INDEX_LANGUAGE = -10;
    const INDEX_PROFILE = -11;
    const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
    const [languageMenuIndex, setLanguageMenuIndex] = useState(0);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 18;

    /* 
    const login = useGoogleLogin({
        onSuccess: (tokenResponse) => {
            handleLoginSuccess(tokenResponse);
        },
        onError: () => console.log('Login Failed'),
    });
    */

    // Handle Messages
    useEffect(() => {
        if (isConnected) {
            sendMessage({ type: "LIST_ROOMS", payload: { type: channelType } });
        }
    }, [isConnected, sendMessage, channelType]);

    useEffect(() => {
        if (lastMessage) {
            if (lastMessage.type === "ROOM_LIST") {
                setRooms(lastMessage.payload);
                setHasList(true);
            } else if (lastMessage.type === "ROOM_CREATED") {
                // Auto-share only for private channels (is_public === 0)
                navigate(`/room/${lastMessage.payload.id}`, { state: { showShareOnLoad: !lastMessage.payload.is_public } });
                clearMessage(); // Clear message to avoid loop
            }
        }
    }, [lastMessage, navigate, clearMessage]);

    // Handle Delete Account Success (GDPR)
    useEffect(() => {
        if (lastMessage && lastMessage.type === "DELETE_ACCOUNT_SUCCESS") {
            handleLogout();
            setShowProfileModal(false);
            setShowDeleteConfirm(false);
            // navigate('/'); // Already in lobby or will be redirected
        }
    }, [lastMessage, handleLogout]);

    // Dismiss password modal if room no longer exists
    useEffect(() => {
        if (lastErrorCode === "ROOM_NOT_FOUND" && showPasswordModal) {
            setShowPasswordModal(false);
            setPasswordRoomId(null);
            setPasswordInput("");
        }
    }, [lastErrorCode, showPasswordModal]);

    // Handle Join Success (In-Lobby Password Check)
    useEffect(() => {
        if (state && passwordRoomId && state.roomId === passwordRoomId && showPasswordModal) {
            setShowPasswordModal(false);
            // Carry the verified password along: RoomBody re-sends JOIN_ROOM on
            // mount and on reconnects, and the server re-checks it every time —
            // navigating without it bounced the user straight back to the modal.
            navigate(`/room/${passwordRoomId}`, { state: { alreadyJoined: true, password: passwordInput } });
        }
    }, [state, passwordRoomId, showPasswordModal, passwordInput, navigate]);


    // Handle column resize
    useEffect(() => {
        const updateColumns = () => {
            if (window.innerWidth >= 1024) setColumns(4);
            else if (window.innerWidth >= 768) setColumns(3);
            else setColumns(2);
        };

        updateColumns();
        window.addEventListener('resize', updateColumns);
        return () => window.removeEventListener('resize', updateColumns);
    }, []);

    // Filter rooms based on search and language flag
    const filteredRooms = useMemo(() => {
        let result = rooms.filter(room =>
            room.name.toLowerCase().includes(searchQuery.toLowerCase())
        );

        if (filterLanguageFlag !== 'international') {
            result = result.filter(room => room.language_flag === filterLanguageFlag);
        }

        // Sort: Active First -> Most Listeners -> Alphabetical
        result.sort((a, b) => {
            if (a.isActive && !b.isActive) return -1;
            if (!a.isActive && b.isActive) return 1;

            const listenersA = a.listeners || 0;
            const listenersB = b.listeners || 0;
            if (listenersB !== listenersA) {
                return listenersB - listenersA;
            }

            return a.name.localeCompare(b.name);
        });

        return result;
    }, [rooms, searchQuery, filterLanguageFlag]);

    // Reset page to 1 when filter changes
    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, channelType, filterLanguageFlag]);

    // Calculate Pagination
    // Total virtual items = 1 (Create Button) + filteredRooms.length
    const totalItemsCount = 1 + filteredRooms.length;
    const totalPages = Math.ceil(totalItemsCount / ITEMS_PER_PAGE);

    // Get indices for current page
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;

    // Determine if Create Button is on this page
    const showCreateButton = startIndex === 0;

    // Calculate which rooms to show
    // If showCreateButton is true, we need to take items from filteredRooms starting at 0 to (ITEMS_PER_PAGE - 1)
    // If showCreateButton is false, we take from (startIndex - 1) to (endIndex - 1)
    const roomSliceStart = showCreateButton ? 0 : startIndex - 1;
    const roomSliceEnd = showCreateButton ? ITEMS_PER_PAGE - 1 : endIndex - 1;

    const visibleRooms = filteredRooms.slice(roomSliceStart, roomSliceEnd);

    const handleCreateRoomClick = () => {
        if (!isSignedIn(user)) {
            if (!hasConsent) {
                alert(t('lobby.acceptCookies'));
            } else {
                alert(t('lobby.loginToCreate'));
            }
            return;
        }
        setIsCreatingRoom(true);
        setIsPrivate(true);
        setCreatePassword("");
    };

    const handleRoomClick = (room) => {
        if (room.is_protected) {
            setPasswordRoomId(room.id);
            setShowPasswordModal(true);
            setPasswordInput("");
            setPasswordError("");
        } else {
            navigate(`/room/${room.id}`);
        }
    };

    // Handle Keyboard Navigation
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (isCreatingRoom || showPasswordModal || showProfileModal || showDeleteConfirm) return;

            // Language Menu Navigation
            if (languageMenuOpen) {
                e.preventDefault(); // Capture all keys when menu is open
                if (e.key === 'Escape' || e.key === 'ArrowLeft') {
                    setLanguageMenuOpen(false);
                    return;
                }
                if (e.key === 'ArrowDown') {
                    setLanguageMenuIndex(prev => Math.min(prev + 1, languages.length - 1));
                    return;
                }
                if (e.key === 'ArrowUp') {
                    setLanguageMenuIndex(prev => Math.max(prev - 1, 0));
                    return;
                }
                if (e.key === 'Enter') {
                    const selectedLang = languages[languageMenuIndex];
                    if (selectedLang) {
                        setLanguage(selectedLang.code);
                    }
                    setLanguageMenuOpen(false);
                    return;
                }
                return;
            }

            // Search Input Handling
            if (document.activeElement.tagName === 'INPUT') {
                if (e.key === 'Escape') {
                    e.target.blur();
                    return;
                }
                if (e.key === 'ArrowDown' || e.key === 'Enter') {
                    e.preventDefault();
                    document.activeElement.blur();
                    setFocusedIndex(-1); // Move focus to Private Filter
                    return;
                }
                if (e.key === 'ArrowLeft' && e.target.selectionStart === 0) {
                    e.preventDefault();
                    document.activeElement.blur();
                    // Go to right-most filter
                    if (user) setFocusedIndex(-4); // My Channels
                    else setFocusedIndex(-1); // Private
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    document.activeElement.blur();
                    setFocusedIndex(INDEX_PROFILE); // Go to Profile/Google Button
                }
                return; // Let user type in search
            }

            if (e.key.startsWith('Arrow') || e.key === 'Enter') setKeyboardFocus(true);

            // Total items on THIS page
            const currentItemsCount = (showCreateButton ? 1 : 0) + visibleRooms.length;
            const totalItems = currentItemsCount;

            if (e.key === 'ArrowRight') {
                e.preventDefault();
                // Header Navigation
                if (focusedIndex === INDEX_LANGUAGE) setFocusedIndex(INDEX_PROFILE);
                else if (focusedIndex === INDEX_PROFILE) { /* Stop or loop? Stop at Profile (Rightmost) */ }

                // Filter Navigation
                else if (focusedIndex === -2) setFocusedIndex(-1); // Public -> Private
                else if (focusedIndex === -1 && user) setFocusedIndex(-4); // Private -> My Channels
                else if (focusedIndex === -1 && !user) {
                    // Private -> Search (if no My Channels)
                    document.getElementById('channel-search')?.focus();
                    setFocusedIndex(-3);
                }
                else if (focusedIndex === -4) {
                    // My Channels -> Search
                    document.getElementById('channel-search')?.focus();
                    setFocusedIndex(-3);
                }
                else if (focusedIndex >= 0) setFocusedIndex(prev => Math.min(prev + 1, totalItems - 1));
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                // Header Navigation
                if (focusedIndex === INDEX_PROFILE) setFocusedIndex(INDEX_LANGUAGE);
                else if (focusedIndex === INDEX_LANGUAGE) { /* Stop at Language (Leftmost) */ }

                // Filter Navigation
                else if (focusedIndex === -1) setFocusedIndex(-2); // Private -> Public
                else if (focusedIndex === -4) setFocusedIndex(-1); // My Channels -> Private
                else if (focusedIndex === -2) { /* stay */ }
                else if (focusedIndex >= 0) setFocusedIndex(prev => Math.max(prev - 1, 0));
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                // Header -> Search
                if (focusedIndex === INDEX_LANGUAGE || focusedIndex === INDEX_PROFILE) {
                    document.getElementById('channel-search')?.focus();
                    setFocusedIndex(-3);
                }
                else if (focusedIndex === -3) { // Search -> Filters (handled in Input block mostly, but if focusedIndex is stuck)
                    setFocusedIndex(-1);
                }
                else if (focusedIndex < 0) setFocusedIndex(0); // Filters -> Grid Start
                else {
                    setFocusedIndex(prev => {
                        return Math.min(prev + columns, totalItems - 1);
                    });
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                // Search -> Header
                if (focusedIndex === -3) setFocusedIndex(INDEX_PROFILE);

                // Filters -> Search
                else if (focusedIndex === -1 || focusedIndex === -2 || focusedIndex === -4) {
                    document.getElementById('channel-search')?.focus();
                    setFocusedIndex(-3);
                }
                // Grid -> Filters/Search
                else if (focusedIndex >= 0) {
                    if (focusedIndex < columns) {
                        // Top row -> Search
                        document.getElementById('channel-search')?.focus();
                        setFocusedIndex(-3);
                    } else {
                        setFocusedIndex(prev => prev - columns);
                    }
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (focusedIndex === INDEX_LANGUAGE) {
                    setLanguageMenuOpen(true);
                    // Find current language index
                    const idx = languages.findIndex(l => l.code === language);
                    setLanguageMenuIndex(idx >= 0 ? idx : 0);
                }
                else if (focusedIndex === INDEX_PROFILE) {
                    if (user) setShowProfileModal(true);
                    else {
                        // Trigger Google Login
                        // Since Google button is handled via SDK/Button click, we might need a simulated click or ref
                        // We put an id on the button: 'lobby-auth-button'
                        document.getElementById('lobby-auth-button')?.click();
                    }
                }
                else if (focusedIndex === -2) setChannelType('public');
                else if (focusedIndex === -1) setChannelType('private');
                else if (focusedIndex === -4) setChannelType('my_channels');
                else if (focusedIndex >= 0 && focusedIndex < totalItems) {
                    if (focusedIndex === 0) {
                        // Create Room (Index 0)
                        handleCreateRoomClick();
                    } else {
                        // Join Room
                        let roomToJoin;
                        if (showCreateButton) {
                            roomToJoin = visibleRooms[focusedIndex - 1]; // Index 0 is safe-guarded above
                        } else {
                            roomToJoin = visibleRooms[focusedIndex];
                        }

                        if (roomToJoin) {
                            handleRoomClick(roomToJoin);
                        }
                    }
                }
            } else if (e.key === '/' || (e.ctrlKey && e.key === 'f') || (e.metaKey && e.key === 'k')) {
                // Focus search
                e.preventDefault();
                document.getElementById('channel-search')?.focus();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visibleRooms, columns, focusedIndex, isCreatingRoom, showPasswordModal, navigate, showCreateButton, user, languageMenuOpen, languageMenuIndex, language, setLanguage, showProfileModal, showDeleteConfirm]);

    // Reset focused index when filtered rooms change
    useEffect(() => {
        setFocusedIndex(0);
    }, [visibleRooms.length, currentPage]);

    // Detect scrolling to prevent accidental mouse selection
    useEffect(() => {
        let scrollTimeout;
        const handleScroll = () => {
            isScrolling.current = true;
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                isScrolling.current = false;
            }, 100);
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => {
            window.removeEventListener('scroll', handleScroll);
            clearTimeout(scrollTimeout);
        };
    }, []);

    // Close filter flag dropdown on outside click
    useEffect(() => {
        if (!filterFlagOpen) return;
        const handleClick = (e) => {
            if (filterFlagRef.current && !filterFlagRef.current.contains(e.target)) {
                setFilterFlagOpen(false);
                setFilterFlagSearch("");
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [filterFlagOpen]);

    // Auto-scroll to focused item
    useEffect(() => {
        if (focusedIndex >= 0) {
            const element = document.getElementById(`lobby-item-${focusedIndex}`);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        } else if (focusedIndex === INDEX_LANGUAGE) {
            document.getElementById('lobby-language-switcher')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else if (focusedIndex === INDEX_PROFILE) {
            document.getElementById('lobby-profile-section')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusedIndex]);

    // Handle Escape Key to Close Modals
    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                if (isCreatingRoom) setIsCreatingRoom(false);
                if (showPasswordModal) setShowPasswordModal(false);
                if (showProfileModal) setShowProfileModal(false);
                if (showDeleteConfirm) setShowDeleteConfirm(false);
            }
        };

        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [isCreatingRoom, showPasswordModal, showProfileModal, showDeleteConfirm]);

    // Handle Password Required Error
    useEffect(() => {
        if (lastErrorCode === "PASSWORD_REQUIRED") {
            if (showPasswordModal) {
                setPasswordError("wrong");
            }
        }
    }, [lastErrorCode, showPasswordModal]);

    const submitCreateRoom = (e) => {
        e.preventDefault();
        if (!newRoomName.trim()) return;

        sendMessage({
            type: "CREATE_ROOM",
            payload: {
                name: newRoomName,
                description: `Hosted by ${user.name}`,
                color: "from-gray-700 to-black",
                isPrivate,
                password: isPrivate ? createPassword : null,
                languageFlag,
                provider: appleMusicAvailable ? provider : 'youtube'
            }
        });
        setIsCreatingRoom(false);
        setNewRoomName("");
        setProvider('youtube');
        setIsPrivate(true);
        setCreatePassword("");
        setLanguageFlag('international');
        setLanguageFlagOpen(false);
        setCreateFlagSearch("");
    };

    const submitPasswordJoin = (e) => {
        e.preventDefault();
        setPasswordError("");
        // Attempt to join directly from Lobby
        sendMessage({ type: "JOIN_ROOM", payload: { roomId: passwordRoomId, password: passwordInput } });
    };

    const handleDeleteAccount = () => {
        sendMessage({ type: "DELETE_ACCOUNT", payload: {} });
    };

    // Marked by the arrow keys (see keyboardFocus).
    const isFocused = (index) => keyboardFocus && focusedIndex === index;
    const pointAt = (index) => {
        if (isScrolling.current) return;
        if (keyboardFocus) setKeyboardFocus(false);
        if (focusedIndex !== index) setFocusedIndex(index);
    };
    const createLabel = isSignedIn(user) ? t('lobby.createChannel') : (!hasConsent ? t('lobby.acceptCookies') : t('lobby.loginToCreate'));
    const CreateIcon = !isSignedIn(user) && !hasConsent ? Cookie : Sparkles;
    // "Everywhere": on a phone a quiet line icon, so that the cards keep the
    // eye; from a tablet up the blue globe, a little light on the black page.
    const worldMark = (size, className = '') => (
        <>
            <Globe size={size} className={`sm:hidden ${className}`} />
            <span className="max-sm:hidden">{getFlagEmoji('international')}</span>
        </>
    );
    const tabClass = (active, index) =>
        `cv-hit flex h-9 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors duration-150 sm:flex-none ${active ? 'bg-raised text-ink' : 'text-ink-2 hover:text-ink'} ${isFocused(index) ? 'relative z-10 text-ink ring-2 ring-accent' : ''}`;
    const avatar = (size) => <Avatar picture={user.picture} name={displayName(user, t)} className={size} />;
    // A channel is created with the line "Hosted by <name>"; say it in the
    // reader's language. Anything else a channel carries there shows as it is.
    const hostLine = (description) => {
        const host = /^Hosted by (.+)$/.exec(description || '');
        return host ? t('lobby.hostedBy', { name: host[1] }) : description;
    };

    return (
        <div className="min-h-screen bg-page text-ink flex flex-col items-center px-4 sm:px-8 pt-[calc(1.5rem+env(safe-area-inset-top))] sm:pt-[calc(2rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))]">


            <header className="relative z-50 mb-8 flex w-full max-w-5xl items-center justify-between gap-2 sm:mb-10 sm:gap-4">
                <div className="flex items-center gap-2 sm:gap-4">
                    <div className="flex flex-col">
                        <h1 className="text-[1.75rem] font-bold leading-8 tracking-tight text-accent">
                            CueVote
                        </h1>
                        <YouTubeBrandSubtitle className="mt-0.5 whitespace-nowrap" />
                    </div>

                    {/* Language Switcher */}
                    <LanguageSwitcher
                        isOpen={languageMenuOpen}
                        onToggle={(val) => {
                            setLanguageMenuOpen(val);
                            if (val) setFocusedIndex(INDEX_LANGUAGE);
                        }}
                        focused={isFocused(INDEX_LANGUAGE)}
                        focusedLanguageIndex={languageMenuIndex}
                        compact={!isSignedIn(user)}
                    />
                </div>

                {/* Mobile User Profile (Visible only on small screens). The
                    sign-in button gives way when its words are long (Polish,
                    Hungarian, Arabic): it shortens instead of pushing the page
                    wider than the screen. */}
                <div className={`sm:hidden ${isSignedIn(user) ? 'flex-none' : 'min-w-0'}`}>
                    {isSignedIn(user) ? (
                        <button
                            onClick={() => setShowProfileModal(true)}
                            className={`cv-hit flex items-center rounded-full transition-transform duration-150 ease-cv active:scale-95 ${isFocused(INDEX_PROFILE) ? 'ring-2 ring-accent' : ''}`}
                            aria-label={t('header.profileSettings')}
                        >
                            {avatar('h-9 w-9')}
                        </button>
                    ) : (
                        <GoogleAuthButton
                            onLoginSuccess={handleLoginSuccess}
                            render={(performLogin, disabled) => (
                                <button
                                    id="lobby-auth-button-mobile"
                                    type="button"
                                    onTouchEnd={(e) => {
                                        // iOS Fix: Trigger immediately on touch release preventing ghost clicks
                                        e.preventDefault();
                                        performLogin();
                                    }}
                                    onClick={performLogin}
                                    className={`cv-hit flex h-9 max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-raised px-2.5 text-xs font-medium text-ink transition-[background-color,transform] duration-150 ease-cv active:scale-95 ${disabled && !isFocused(INDEX_PROFILE) ? 'opacity-60' : 'hover:bg-[#2b2927]'} ${isFocused(INDEX_PROFILE) ? 'ring-2 ring-accent' : ''}`}
                                >
                                    <GoogleGIcon className="h-3.5 w-3.5 flex-none" />
                                    <span className="truncate">{t('lobby.signInGoogle')}</span>
                                </button>
                            )}
                        />
                    )}
                </div>

                {/* Desktop User Profile */}
                <div className="hidden min-w-0 sm:block" id="lobby-profile-section">
                    {isSignedIn(user) ? (
                        <button
                            id="lobby-auth-button"
                            onClick={() => setShowProfileModal(true)}
                            className={`group flex h-10 max-w-full cursor-pointer items-center gap-2.5 rounded-full pl-1 pr-3.5 transition-colors duration-150 hover:bg-raised ${isFocused(INDEX_PROFILE) ? 'bg-raised ring-2 ring-accent' : ''}`}
                            title={t('header.profileSettings')}
                        >
                            {avatar('h-8 w-8')}
                            <span dir="auto" className="cv-bidi min-w-0 truncate text-sm font-medium text-ink-2 transition-colors duration-150 group-hover:text-ink">{t('lobby.welcome')}, {displayName(user, t)}</span>
                        </button>
                    ) : (
                        <GoogleAuthButton
                            onLoginSuccess={handleLoginSuccess}
                            render={(performLogin, disabled) => (
                                <button
                                    id="lobby-auth-button"
                                    onClick={performLogin}
                                    className={`cv-btn cv-btn-quiet rounded-full ${disabled && !isFocused(INDEX_PROFILE) ? 'opacity-60' : ''} ${isFocused(INDEX_PROFILE) ? 'ring-2 ring-accent' : ''}`}
                                    title={disabled ? t('lobby.acceptCookies') : ""}
                                >
                                    <GoogleGIcon className="h-4 w-4" />
                                    {t('lobby.signInGoogle')}
                                </button>
                            )}
                        />
                    )}
                </div>
            </header>

            {lastError && (
                <div className="pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4">
                    <div className="animate-fadeIn flex items-center gap-3 rounded-xl border border-red-500/40 bg-[#2a1311] px-4 py-3 text-ink shadow-2xl">
                        <AlertCircle size={18} className="flex-none text-red-400" />
                        <span className="text-sm font-medium">{lastError}</span>
                    </div>
                </div>
            )}

            <main className="w-full max-w-5xl">
                <div className="mb-6 flex flex-col gap-4">
                    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                        <h2 className="text-2xl font-semibold leading-8 tracking-tight">{t('lobby.browseChannels')}</h2>

                        {/* Search Bar with integrated Language Filter */}
                        <div className="relative w-full md:w-80" ref={filterFlagRef}>
                            <button
                                type="button"
                                onClick={() => { setFilterFlagOpen(!filterFlagOpen); if (!filterFlagOpen) setFilterFlagSearch(""); }}
                                className={`absolute inset-y-0 left-0 z-10 flex items-center gap-1 rounded-l-xl pl-3 pr-2 transition-colors duration-150 ${filterLanguageFlag !== 'international' ? 'text-ink' : 'text-ink-3 hover:text-ink-2'}`}
                                title={t('lobby.videoLanguage')}
                            >
                                <span className="flex items-center text-base leading-none">
                                    {filterLanguageFlag === 'international' ? worldMark(16) : getFlagEmoji(filterLanguageFlag)}
                                </span>
                                <ChevronDown size={12} className={`transition-transform duration-150 ${filterFlagOpen ? 'rotate-180' : ''}`} />
                            </button>
                            <input
                                id="channel-search"
                                type="text"
                                className={`block h-11 w-full rounded-xl border bg-card pl-14 pr-3 text-base text-ink sm:h-10 placeholder:text-ink-3 transition-[border-color,box-shadow] duration-150 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent/70 sm:text-sm ${filterFlagOpen ? 'border-accent/50' : 'border-line'}`}
                                placeholder={filterFlagOpen ? t('lobby.searchCountries') : t('lobby.searchPlaceholder')}
                                value={filterFlagOpen ? filterFlagSearch : searchQuery}
                                onChange={(e) => filterFlagOpen ? setFilterFlagSearch(e.target.value) : setSearchQuery(e.target.value)}
                            />
                            {filterFlagOpen && (
                                <div className="absolute left-0 top-full z-50 mt-1 w-full origin-top-left overflow-y-auto overscroll-contain rounded-xl border border-line bg-card py-1 shadow-xl animate-in fade-in zoom-in-95 duration-150 ease-cv" style={{ maxHeight: '20rem' }}>
                                    {localizedCountries.filter(lang =>
                                        lang.code === 'international' || lang.search.includes(filterFlagSearch.toLowerCase())
                                    ).map(lang => (
                                        <button
                                            key={lang.code}
                                            onClick={() => { setFilterLanguageFlag(lang.code); setFilterFlagOpen(false); setFilterFlagSearch(""); }}
                                            className={`flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-raised sm:min-h-0 ${filterLanguageFlag === lang.code ? 'bg-accent/10 font-medium text-accent' : 'text-ink'}`}
                                        >
                                            <span className="flex w-5 justify-center text-base leading-none">
                                                {lang.code === 'international' ? worldMark(16, 'text-ink-2') : lang.emoji}
                                            </span>
                                            <span>{lang.label}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Filters: three equal tabs on a phone, as wide as their words above that */}
                    <div className="flex w-full gap-1 rounded-xl border border-line bg-card p-1 sm:w-fit">
                        <button onClick={() => setChannelType('public')} className={tabClass(channelType === 'public', -2)}>
                            <Globe size={16} className="max-sm:hidden" /> {t('lobby.public')}
                        </button>
                        <button onClick={() => setChannelType('private')} className={tabClass(channelType === 'private', -1)}>
                            <Lock size={16} className="max-sm:hidden" /> {t('lobby.private')}
                        </button>
                        {user && (
                            <button onClick={() => setChannelType('my_channels')} className={tabClass(channelType === 'my_channels', -4)}>
                                <UserRound size={16} className="max-sm:hidden" /> {t('lobby.myChannels')}
                            </button>
                        )}
                    </div>
                </div>

                {showConnectingOverlay || !hasList ? (
                    <LoadingScreen embedded isOnline={isOnline} message={t('lobby.connecting')} reconnectAttempt={reconnectAttempt} onForceReconnect={forceReconnect} />
                ) : (
                    <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
                        {/* Create Room Button - Only on First Page */}
                        {showCreateButton && (
                            <button
                                id="lobby-item-0"
                                onClick={() => {
                                    handleCreateRoomClick();
                                    setFocusedIndex(0);
                                }}
                                onMouseEnter={() => pointAt(0)}
                                onMouseMove={() => pointAt(0)}
                                className={`group order-first relative aspect-[4/3] w-full scroll-mb-24 scroll-mt-56 rounded-2xl border border-accent bg-card transition-[background-color,box-shadow,transform] duration-150 ease-cv active:scale-[0.98] ${isFocused(0) ? "ring-4 ring-accent" : "ring-2 ring-accent/50"} ${isSignedIn(user) ? "cursor-pointer hover:bg-raised" : "cursor-not-allowed"}`}
                                title={createLabel}
                            >
                                {/* The lobby's one lit tile: an orange outline, the icon in
                                    orange, the words in ink. Without consent it asks for the
                                    cookies and shows a cookie. Reached with the arrow keys
                                    (TV remote) the outline doubles in width. */}
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-2 py-3 sm:gap-4 sm:p-5">
                                    <CreateIcon className="h-7 w-7 flex-none text-accent sm:h-8 sm:w-8" strokeWidth={1.75} aria-hidden="true" />
                                    <span className="max-w-full hyphens-auto text-center text-sm font-medium text-ink [overflow-wrap:anywhere] sm:text-base">
                                        {createLabel}
                                    </span>
                                </div>
                            </button>
                        )}

                        {/* Filtered Rooms */}
                        {filteredRooms.length === 0 && searchQuery && (
                            <div className="col-span-full flex flex-col items-center py-12 text-center text-ink-2">
                                <Search className="mb-2 h-6 w-6 text-ink-3" />
                                <p>{t('lobby.noChannelsFound')} "{searchQuery}"</p>
                            </div>
                        )}

                        {visibleRooms.map((channel, i) => {
                            // Adjust index:
                            // If create button is shown, first room is index 1.
                            // If not, first room is index 0.
                            const actualIndex = showCreateButton ? i + 1 : i;
                            const hasThumbnail = channel.currentTrack?.thumbnail && hasConsent && !failedThumbnails.has(channel.currentTrack.thumbnail);

                            return (
                                <div
                                    key={channel.id}
                                    id={`lobby-item-${actualIndex}`}
                                    onClick={() => {
                                        setFocusedIndex(actualIndex);
                                        handleRoomClick(channel); // Use handler instead of direct navigate
                                    }}
                                    onMouseEnter={() => pointAt(actualIndex)}
                                    onMouseMove={() => pointAt(actualIndex)}
                                    className={`group relative aspect-[4/3] w-full cursor-pointer scroll-mb-24 scroll-mt-56 overflow-hidden rounded-2xl border bg-card text-left transition-[border-color,transform] duration-150 ease-cv active:scale-[0.98] ${isFocused(actualIndex)
                                        ? "z-10 border-transparent ring-2 ring-accent"
                                        : "border-line hover:border-ink/25"
                                        }`}
                                >
                                    <div className="absolute inset-0">
                                        {hasThumbnail ? (
                                            <>
                                                <img
                                                    src={channel.currentTrack.thumbnail}
                                                    alt=""
                                                    className="h-full w-full object-cover"
                                                    onError={() => setFailedThumbnails(prev => new Set(prev).add(channel.currentTrack.thumbnail))}
                                                />
                                                {/* The words sit at the bottom: darker there, the picture clearer above. */}
                                                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/30 transition-opacity duration-150 group-hover:opacity-90" />
                                            </>
                                        ) : null}
                                        {/* Apple channels never send a thumbnail, so a warm glow
                                            from the label's corner fills the card instead. */}
                                        {channel.provider === 'apple' && (
                                            <div className="absolute inset-0 bg-[radial-gradient(130%_100%_at_0%_0%,rgba(249,115,22,0.22),transparent_60%)]" />
                                        )}
                                    </div>

                                    <div className="absolute inset-0 z-10 flex flex-col p-3 sm:p-5">
                                        {/* The source in words, set like the rest of the card: Apple
                                            allows its badges and icon only as links to Apple Music,
                                            and the name stays "Apple Music" in every language. */}
                                        {channel.provider === 'apple' && (
                                            <span className="text-xs font-semibold text-orange-400">
                                                Apple Music
                                            </span>
                                        )}

                                        <div className="mt-auto min-w-0">
                                            {/* The whole name, on up to two lines. */}
                                            <h3 dir="auto" className="cv-bidi line-clamp-2 break-words text-base font-semibold leading-snug text-ink sm:text-lg sm:leading-6">
                                                {channel.name}
                                            </h3>
                                            {/* One line, and none on a phone, where the card has no room
                                                for it: the name and the source label keep theirs. */}
                                            <p dir="auto" className="cv-bidi mt-0.5 line-clamp-1 text-sm text-ink-2 max-sm:hidden">{hostLine(channel.description)}</p>

                                            <div className="mt-2 flex items-center justify-between gap-2 text-xs font-medium text-ink-2 sm:mt-3">
                                                <div className="flex items-center gap-1.5 tabular-nums">
                                                    <Users size={14} className="text-ink-3" /> <span>{formatCount(channel.listeners, language)} {t('lobby.live')}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {channel.is_protected && <Lock size={14} className="text-ink-2" />}
                                                    <span className="flex h-4 items-center text-sm leading-none" title={localizedCountries.find(l => l.code === channel.language_flag)?.label || 'International'}>
                                                        {/* The globe also for a country the lobby has no flag for. */}
                                                        {hasFlag(channel.language_flag)
                                                            ? getFlagEmoji(channel.language_flag)
                                                            : worldMark(14, 'text-ink-3')}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )
                }

                {/* Pagination Controls */}
                {
                    totalPages > 1 && (
                        <div className="mt-8 flex items-center justify-center gap-4">
                            <button
                                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                disabled={currentPage === 1}
                                className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-card text-ink-2 transition-colors duration-150 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <ChevronLeft size={18} />
                            </button>

                            <div className="text-sm font-medium tabular-nums text-ink-2">
                                Page <span className="text-ink">{currentPage}</span> of <span className="text-ink">{totalPages}</span>
                            </div>

                            <button
                                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                disabled={currentPage === totalPages}
                                className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-card text-ink-2 transition-colors duration-150 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <ChevronRight size={18} />
                            </button>
                        </div>
                    )
                }
            </main >

            {/* Create Room Modal */}
            {
                isCreatingRoom && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                        <div className="bg-card border border-line rounded-2xl w-full max-w-md p-6 shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-xl font-semibold text-ink">{t('lobby.createNewChannel')}</h3>
                                <button onClick={() => setIsCreatingRoom(false)} className="text-ink-3 hover:text-ink transition-colors duration-150">
                                    <X size={24} />
                                </button>
                            </div>

                            <form onSubmit={submitCreateRoom}>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-ink-2 mb-1.5">{t('lobby.channelName')}</label>
                                        <input
                                            type="text"
                                            value={newRoomName}
                                            onChange={(e) => setNewRoomName(e.target.value.slice(0, 100))}
                                            placeholder={t('lobby.channelNamePlaceholder')}
                                            maxLength={100}
                                            className="w-full bg-page border border-line rounded-xl px-4 py-3 text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent transition-colors duration-150"
                                            autoFocus
                                        />
                                        <div className="flex justify-end mt-1">
                                            <span className={`text-xs ${newRoomName.length >= 100 ? 'text-red-500 font-bold' : 'text-ink-3'}`}>
                                                {newRoomName.length}/100
                                            </span>
                                        </div>
                                    </div>

                                    {/* The sources in words: Apple allows its badges and icon only
                                        as links to Apple Music, YouTube its logo only as a link to
                                        YouTube content, and neither is a link here. */}
                                    {appleMusicAvailable && (
                                        <div>
                                            <p id="create-source-label" className="block text-sm font-medium text-ink-2 mb-1.5">{t('appleMusic.source')}</p>
                                            <SegmentedControl
                                                labelledBy="create-source-label"
                                                value={provider}
                                                onChange={setProvider}
                                                options={[
                                                    { value: 'youtube', label: 'YouTube' },
                                                    { value: 'apple', label: 'Apple Music' },
                                                ]}
                                            />
                                            {provider === 'apple' && (
                                                <p className="mt-2 text-xs text-ink-2 animate-in fade-in slide-in-from-top-1 duration-200">{t('appleMusic.sourceHint')}</p>
                                            )}
                                        </div>
                                    )}

                                    <div>
                                        <p id="create-privacy-label" className="block text-sm font-medium text-ink-2 mb-1.5">{t('lobby.privacy')}</p>
                                        <SegmentedControl
                                            labelledBy="create-privacy-label"
                                            value={isPrivate ? 'private' : 'public'}
                                            onChange={(choice) => {
                                                if (choice === 'public') {
                                                    setIsPrivate(false);
                                                    return;
                                                }
                                                setIsPrivate(true);
                                                setLanguageFlag('international');
                                                setLanguageFlagOpen(false);
                                            }}
                                            options={[
                                                { value: 'public', label: t('lobby.public'), icon: Globe },
                                                { value: 'private', label: t('lobby.private'), icon: Lock },
                                            ]}
                                        />
                                    </div>

                                    {!isPrivate && (
                                        <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                                            <label className="block text-sm font-medium text-ink-2 mb-1.5">{t('lobby.videoLanguage')}</label>
                                            <div className="relative">
                                                {languageFlagOpen ? (
                                                    <div className="w-full bg-page border border-accent/50 rounded-xl px-4 py-3 flex items-center gap-2">
                                                        <span className="text-lg">{getFlagEmoji(languageFlag)}</span>
                                                        <input
                                                            type="text"
                                                            className="flex-1 bg-transparent text-ink text-sm focus:outline-none placeholder:text-ink-3"
                                                            placeholder={t('lobby.searchCountries')}
                                                            value={createFlagSearch}
                                                            onChange={(e) => setCreateFlagSearch(e.target.value)}
                                                            autoFocus
                                                        />
                                                        <button type="button" onClick={() => { setLanguageFlagOpen(false); setCreateFlagSearch(""); }} className="text-ink-3 hover:text-ink">
                                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => { setLanguageFlagOpen(true); setCreateFlagSearch(""); }}
                                                        className="w-full bg-page border border-line rounded-xl px-4 py-3 text-ink text-left flex items-center justify-between hover:border-ink/25 transition-colors duration-150"
                                                    >
                                                        <span className="flex items-center gap-2">
                                                            <span className="text-lg">{getFlagEmoji(languageFlag)}</span>
                                                            <span>{localizedCountries.find(l => l.code === languageFlag)?.label || 'International'}</span>
                                                        </span>
                                                        <svg className="w-4 h-4 text-ink-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                                    </button>
                                                )}
                                                {languageFlagOpen && (
                                                    <div className="absolute z-50 mt-1 w-full bg-card border border-line rounded-xl shadow-xl animate-in fade-in zoom-in-95 duration-150 overflow-y-auto py-1" style={{ maxHeight: '14rem' }}>
                                                        {localizedCountries.filter(lang =>
                                                            lang.code === 'international' || lang.search.includes(createFlagSearch.toLowerCase())
                                                        ).map(lang => (
                                                            <button
                                                                key={lang.code}
                                                                type="button"
                                                                onClick={() => { setLanguageFlag(lang.code); setLanguageFlagOpen(false); setCreateFlagSearch(""); }}
                                                                className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 hover:bg-raised transition-colors duration-150 ${languageFlag === lang.code ? 'text-accent font-medium bg-accent/10' : 'text-ink'}`}
                                                            >
                                                                <span className="text-base">{lang.emoji}</span>
                                                                <span>{lang.label}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {isPrivate && (
                                        <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                                            <label className="block text-sm font-medium text-ink-2 mb-1.5">{t('lobby.passwordOptional')}</label>
                                            <input
                                                type="text"
                                                value={createPassword}
                                                onChange={(e) => setCreatePassword(e.target.value)}
                                                placeholder={t('lobby.passwordPlaceholder')}
                                                className="w-full bg-page border border-line rounded-xl px-4 py-3 text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent transition-colors duration-150"
                                            />
                                        </div>
                                    )}

                                </div>

                                <div className="flex justify-end gap-3 pt-4 border-t border-line mt-6">
                                    <button
                                        type="button"
                                        onClick={() => setIsCreatingRoom(false)}
                                        className="cv-btn cv-btn-ghost"
                                    >
                                        {t('lobby.cancel')}
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={!newRoomName.trim()}
                                        className="cv-btn cv-btn-accent px-5 font-semibold"
                                    >
                                        {t('lobby.createChannel')}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div >
                )
            }

            {
                showPasswordModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                        <div className="bg-card border border-line rounded-2xl w-full max-w-sm p-6 shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-xl font-semibold text-ink flex items-center gap-2">
                                    <Lock size={18} className="text-ink-2" /> Private Channel
                                </h3>
                                <button onClick={() => setShowPasswordModal(false)} className="text-ink-3 hover:text-ink transition-colors duration-150">
                                    <X size={24} />
                                </button>
                            </div>

                            <form onSubmit={submitPasswordJoin} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-ink-2 mb-1.5">{t('lobby.enterPassword')}</label>
                                    <input
                                        type="password"
                                        value={passwordInput}
                                        onChange={(e) => setPasswordInput(e.target.value)}
                                        placeholder={t('lobby.passwordInputPlaceholder')}
                                        className={`w-full bg-page border ${passwordError ? 'border-red-500 focus:border-red-500' : 'border-line focus:border-accent'} rounded-xl px-4 py-3 text-ink placeholder:text-ink-3 focus:outline-none transition-colors duration-150`}
                                        autoFocus
                                    />
                                    {passwordError && (
                                        <div className="text-red-500 text-sm mt-2 font-medium animate-in slide-in-from-top-1">
                                            {t('lobby.wrongPassword')}
                                        </div>
                                    )}
                                </div>

                                <button
                                    type="submit"
                                    className="cv-btn cv-btn-accent mt-2 h-11 w-full font-semibold"
                                >
                                    {t('lobby.unlockJoin')}
                                </button>
                            </form>
                        </div>
                    </div>
                )
            }

            {/* Profile Modal (Copy from Header) */}
            {
                showProfileModal && (
                    <div
                        className="fixed inset-0 z-[50] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200"
                        onClick={() => setShowProfileModal(false)}
                    >
                        <div
                            className="bg-card border border-line rounded-2xl w-full max-w-sm p-6 shadow-2xl scale-100 animate-in zoom-in-95 duration-200"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex flex-col items-center mb-6">
                                <Avatar picture={user?.picture} name={displayName(user, t)} className="mb-4 h-20 w-20" textClassName="text-3xl" />
                                <h3 className="text-xl font-semibold text-ink">{displayName(user, t)}</h3>
                                <p className="text-sm text-ink-2">{user?.email}</p>
                            </div>

                            {!showDeleteConfirm ? (
                                <div className="space-y-3">
                                    <button
                                        onClick={() => {
                                            handleLogout();
                                            setShowProfileModal(false);
                                        }}
                                        className="cv-btn cv-btn-quiet h-11 w-full"
                                    >
                                        <LogOut size={18} /> {t('lobby.signOut')}
                                    </button>

                                    <div className="pt-4 border-t border-line mt-4">
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
                                            placeholder={t('lobby.deleteAccountType') + "..."}
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
                                                handleDeleteAccount();
                                                // Modal will close via useEffect on success
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
                    </div>
                )
            }

            <footer className="mt-12 flex w-full max-w-5xl justify-center border-t border-line py-6">
                <Link to="/legal" className="cv-hit flex items-center gap-2 text-sm font-medium text-ink-2 transition-colors duration-150 hover:text-ink">
                    <Scale size={16} />
                    <span>{t('lobby.terms')}</span>
                </Link>
            </footer>
        </div >
    );
}
