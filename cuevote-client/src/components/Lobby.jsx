// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, Link } from "react-router-dom";
import { Radio, Users, Sparkles, AlertCircle, X, LogOut, Search, Lock, Unlock, Globe, Scale, ChevronLeft, ChevronRight } from "lucide-react";
import { useWebSocketContext } from "../hooks/useWebSocketContext";
import { Consent } from '../contexts/ConsentContext';
import { Language } from '../contexts/LanguageContext';
import { dangerousHtml } from '../utils/sanitizeHtml';
import { LanguageSwitcherExports } from './LanguageSwitcher';
const { LanguageSwitcher, languages } = LanguageSwitcherExports;
import { GoogleAuthButton } from './GoogleAuthButton';
import { GoogleGIcon } from './GoogleGIcon';
import { YouTubeBrandSubtitle } from './YouTubeBrandSubtitle';
import { channelLanguages, getFlagEmoji } from '../constants/channelLanguages';

import { LoadingScreen } from './LoadingScreen';
import { displayName, isSignedIn } from '../utils/participation';

function useLocalizedCountries(uiLanguage) {
    return useMemo(() => {
        // ICU reads a bare 'sr' as Serbian Cyrillic; the Serbian UI strings are Latin.
        const locale = uiLanguage === 'sr' ? 'sr-Latn' : uiLanguage;
        const displayNames = new Intl.DisplayNames([locale, 'en'], { type: 'region' });
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
    // and steal the rooms grid mid-scroll. Starts true so the initial mount shows the spinner immediately.
    const [showConnectingOverlay, setShowConnectingOverlay] = useState(true);
    useEffect(() => {
        if (isConnected) {
            setShowConnectingOverlay(false);
            return;
        }
        const timer = setTimeout(() => setShowConnectingOverlay(true), 2500);
        return () => clearTimeout(timer);
    }, [isConnected]);

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
                alert(t('lobby.acceptCookies') + "!");
            } else {
                alert(t('lobby.loginToCreate') + "!");
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
                setPasswordError("Incorrect password");
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
                languageFlag
            }
        });
        setIsCreatingRoom(false);
        setNewRoomName("");
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

    return (
        <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center p-8 pt-[calc(2rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))]">


            <header className="w-full max-w-5xl flex flex-col sm:flex-row items-center justify-between mb-6 sm:mb-8 gap-4 relative z-50">
                <div className="flex items-start justify-between w-full sm:w-auto gap-4">
                    <div className="flex items-start gap-4">
                        <div className="flex flex-col">
                            <h1 className="text-3xl font-bold text-orange-500 tracking-tight">
                                CueVote
                            </h1>
                            <YouTubeBrandSubtitle className="mt-0.5" />
                        </div>

                        {/* Language Switcher */}
                        <LanguageSwitcher
                            isOpen={languageMenuOpen}
                            onToggle={(val) => {
                                setLanguageMenuOpen(val);
                                if (val) setFocusedIndex(INDEX_LANGUAGE);
                            }}
                            focused={focusedIndex === INDEX_LANGUAGE}
                            focusedLanguageIndex={languageMenuIndex}
                        />
                    </div>

                    {/* Mobile User Profile (Visible only on small screens) */}
                    <div className="sm:hidden">
                        {isSignedIn(user) ? (
                            <button
                                onClick={() => setShowProfileModal(true)}
                                className={`flex items-center gap-2 rounded-full transition-all ${focusedIndex === INDEX_PROFILE ? 'ring-2 ring-orange-500 scale-105' : ''}`}
                            >
                                {user.picture ? (
                                    <img src={user.picture} referrerPolicy="no-referrer" className="w-8 h-8 rounded-full border border-neutral-700" alt={user.name} />
                                ) : (
                                    <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center text-xs font-bold text-neutral-500 border border-neutral-700">
                                        {displayName(user, t).charAt(0)}
                                    </div>
                                )}
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
                                        className={`flex items-center gap-1 px-2 py-1.5 rounded-full border border-neutral-700 bg-neutral-800 text-white text-[10px] font-medium whitespace-nowrap transition-transform active:scale-90 ${disabled && focusedIndex !== INDEX_PROFILE ? 'opacity-50' : 'hover:bg-neutral-700'} ${focusedIndex === INDEX_PROFILE ? 'ring-2 ring-orange-500 scale-105' : ''}`}
                                    >
                                        <GoogleGIcon className="w-3.5 h-3.5" />
                                        <span>{t('lobby.signInGoogle')}</span>
                                    </button>
                                )}
                            />
                        )}
                    </div>
                </div>

                {/* Desktop User Profile */}
                <div className="hidden sm:block" id="lobby-profile-section">
                    {isSignedIn(user) ? (
                        <button
                            id="lobby-auth-button"
                            onClick={() => setShowProfileModal(true)}
                            className={`flex items-center gap-3 px-3 py-1.5 rounded-full hover:bg-neutral-800/50 hover:border-neutral-700 border transition-all group cursor-pointer ${focusedIndex === INDEX_PROFILE ? 'ring-2 ring-orange-500 bg-neutral-800 border-neutral-700 scale-105' : 'border-transparent'}`}
                            title={t('header.profileSettings')}
                        >
                            <div className="flex items-center gap-2">
                                {user.picture ? (
                                    <img src={user.picture} referrerPolicy="no-referrer" className="w-8 h-8 rounded-full border border-neutral-700" alt={user.name} />
                                ) : (
                                    <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center text-xs font-bold text-neutral-500 border border-neutral-700">
                                        {displayName(user, t).charAt(0)}
                                    </div>
                                )}
                                <span className="text-neutral-300 font-medium group-hover:text-white transition-colors">{t('lobby.welcome')}, {displayName(user, t)}</span>
                            </div>
                        </button>
                    ) : (
                        <GoogleAuthButton
                            onLoginSuccess={handleLoginSuccess}
                            render={(performLogin, disabled) => (
                                <button
                                    id="lobby-auth-button"
                                    onClick={performLogin}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-full border border-neutral-700 font-medium transition-all ${disabled ? (focusedIndex === INDEX_PROFILE ? 'bg-neutral-900 text-neutral-500 border-neutral-700' : 'bg-neutral-900/50 text-neutral-600 border-neutral-800 opacity-50 grayscale') : 'bg-neutral-800 hover:bg-neutral-700 text-white active:scale-95'} ${focusedIndex === INDEX_PROFILE ? 'ring-2 ring-orange-500 scale-105' : ''}`}
                                    title={disabled ? t('lobby.acceptCookies') : ""}
                                >
                                    <GoogleGIcon className={`w-5 h-5 ${disabled ? 'opacity-50' : ''}`} />
                                    {t('lobby.signInGoogle')}
                                </button>
                            )}
                        />
                    )}
                </div>
            </header>

            {lastError && (
                <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 animate-bounceIn">
                    <div className="bg-red-900/90 border border-red-500 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 backdrop-blur-md">
                        <AlertCircle size={20} className="text-red-400" />
                        <span className="font-medium">{lastError}</span>
                    </div>
                </div>
            )}

            <main className="w-full max-w-5xl">
                <div className="flex flex-col gap-6 mb-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <h2 className="text-2xl font-semibold leading-tight">{t('lobby.browseChannels')}</h2>

                        {/* Search Bar with integrated Language Filter */}
                        <div className="relative w-full md:w-80" ref={filterFlagRef}>
                            <button
                                type="button"
                                onClick={() => { setFilterFlagOpen(!filterFlagOpen); if (!filterFlagOpen) setFilterFlagSearch(""); }}
                                className={`absolute inset-y-0 left-0 flex items-center pl-3 pr-2 rounded-l-xl transition-colors z-10 ${filterLanguageFlag !== 'international' ? 'text-white' : 'text-neutral-500 hover:text-neutral-300'}`}
                                title={t('lobby.videoLanguage')}
                            >
                                <span className="text-base">{getFlagEmoji(filterLanguageFlag)}</span>
                                <svg className={`w-3 h-3 ml-1 text-neutral-600 transition-transform ${filterFlagOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            </button>
                            <input
                                id="channel-search"
                                type="text"
                                className={`bg-neutral-900 border text-white text-sm rounded-xl block w-full pl-14 p-2.5 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent placeholder-neutral-500 transition-all ${filterFlagOpen ? 'border-orange-500/50' : 'border-neutral-800'}`}
                                placeholder={filterFlagOpen ? "Search countries..." : t('lobby.searchPlaceholder')}
                                value={filterFlagOpen ? filterFlagSearch : searchQuery}
                                onChange={(e) => filterFlagOpen ? setFilterFlagSearch(e.target.value) : setSearchQuery(e.target.value)}
                            />
                            {filterFlagOpen && (
                                <div className="absolute left-0 top-full mt-1 w-full bg-[#1a1a1a] border border-neutral-800 rounded-xl shadow-xl z-50 animate-in fade-in zoom-in-95 duration-150 overflow-y-auto py-1" style={{ maxHeight: '20rem' }}>
                                    {localizedCountries.filter(lang =>
                                        lang.code === 'international' || lang.search.includes(filterFlagSearch.toLowerCase())
                                    ).map(lang => (
                                        <button
                                            key={lang.code}
                                            onClick={() => { setFilterLanguageFlag(lang.code); setFilterFlagOpen(false); setFilterFlagSearch(""); }}
                                            className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 hover:bg-neutral-800 transition-colors ${filterLanguageFlag === lang.code ? 'text-orange-500 font-bold bg-orange-500/10' : 'text-neutral-300'}`}
                                        >
                                            <span className="text-base">{lang.emoji}</span>
                                            <span>{lang.label}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Filters - Scrollable on mobile */}
                    <div className="overflow-x-auto pb-2 -mx-2 px-2 scrollbar-none">
                        <div className="flex bg-neutral-900 rounded-lg p-1.5 gap-2 border border-neutral-800 w-full sm:w-fit">
                            <button
                                onClick={() => setChannelType('public')}
                                className={`flex-1 sm:flex-none px-3 py-2 sm:py-1.5 rounded-md text-sm font-medium transition-all flex items-center justify-center gap-2 whitespace-nowrap ${channelType === 'public' ? 'bg-neutral-800 text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-300'} ${focusedIndex === -2 ? 'ring-2 ring-orange-500 text-white relative z-10' : ''}`}
                            >
                                <Globe size={14} /> {t('lobby.public')}
                            </button>
                            <button
                                onClick={() => setChannelType('private')}
                                className={`flex-1 sm:flex-none px-3 py-2 sm:py-1.5 rounded-md text-sm font-medium transition-all flex items-center justify-center gap-2 whitespace-nowrap ${channelType === 'private' ? 'bg-neutral-800 text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-300'} ${focusedIndex === -1 ? 'ring-2 ring-orange-500 text-white relative z-10' : ''}`}
                            >
                                <Lock size={14} /> {t('lobby.private')}
                            </button>
                            {user && (
                                <button
                                    onClick={() => setChannelType('my_channels')}
                                    className={`flex-1 sm:flex-none px-3 py-2 sm:py-1.5 rounded-md text-sm font-medium transition-all flex items-center justify-center gap-2 whitespace-nowrap ${channelType === 'my_channels' ? 'bg-orange-500/10 text-orange-500 border border-orange-500/50' : 'text-neutral-500 hover:text-neutral-300'}`}
                                >
                                    <Sparkles size={14} /> {t('lobby.myChannels')}
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {showConnectingOverlay ? (
                    <div className="col-span-full py-12">
                        <LoadingScreen embedded isOnline={isOnline} message={t('lobby.connecting')} reconnectAttempt={reconnectAttempt} onForceReconnect={forceReconnect} />
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
                        {/* Create Room Button - Only on First Page */}
                        {showCreateButton && (
                            <button
                                id="lobby-item-0"
                                onClick={() => {
                                    handleCreateRoomClick();
                                    setFocusedIndex(0);
                                }}
                                onMouseEnter={() => {
                                    if (!isScrolling.current) setFocusedIndex(0);
                                }}
                                onMouseMove={() => {
                                    if (!isScrolling.current && focusedIndex !== 0) setFocusedIndex(0);
                                }}
                                className={`scroll-mt-56 scroll-mb-24 rounded-2xl border relative transition-all duration-300 w-full aspect-[4/3] order-first ${focusedIndex === 0
                                    ? "border-orange-500 ring-2 ring-orange-500/50 scale-[1.02] bg-neutral-800/50"
                                    : isSignedIn(user)
                                        ? "border-neutral-800 text-neutral-500 cursor-pointer"
                                        : "border-neutral-900 text-neutral-700 cursor-not-allowed"
                                    }`}
                                title={isSignedIn(user) ? t('lobby.createChannel') : (!hasConsent ? t('lobby.acceptCookies') : t('lobby.loginToCreate'))}
                            >
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-4 sm:p-6">
                                    <Sparkles size={32} className={focusedIndex === 0 ? "text-orange-500" : ""} />
                                    <span className={`font-medium text-center ${focusedIndex === 0 ? "text-white" : ""}`}>
                                        {isSignedIn(user) ? t('lobby.createChannel') : (!hasConsent ? t('lobby.acceptCookies') : t('lobby.loginToCreate'))}
                                    </span>
                                </div>
                            </button>
                        )}

                        {/* Filtered Rooms */}
                        {filteredRooms.length === 0 && searchQuery && (
                            <div className="col-span-full text-center text-neutral-500 py-12 flex flex-col items-center">
                                <Search className="w-8 h-8 mb-2 opacity-50" />
                                <p>{t('lobby.noChannelsFound')} "{searchQuery}"</p>
                            </div>
                        )}

                        {visibleRooms.map((channel, i) => {
                            // Adjust index:
                            // If create button is shown, first room is index 1.
                            // If not, first room is index 0.
                            const actualIndex = showCreateButton ? i + 1 : i;

                            return (
                                <div
                                    key={channel.id}
                                    id={`lobby-item-${actualIndex}`}
                                    onClick={() => {
                                        setFocusedIndex(actualIndex);
                                        handleRoomClick(channel); // Use handler instead of direct navigate
                                    }}
                                    onMouseEnter={() => {
                                        if (!isScrolling.current) setFocusedIndex(actualIndex);
                                    }}
                                    onMouseMove={() => {
                                        if (!isScrolling.current && focusedIndex !== actualIndex) setFocusedIndex(actualIndex);
                                    }}
                                    className={`scroll-mt-56 scroll-mb-24 group relative overflow-hidden rounded-2xl bg-neutral-900 border transition-all duration-300 text-left w-full aspect-[4/3] cursor-pointer ${actualIndex === focusedIndex
                                        ? "border-orange-500 ring-2 ring-orange-500/50 scale-[1.02] z-10"
                                        : "border-neutral-800"
                                        }`}
                                >
                                    <div className="absolute inset-0">
                                        {channel.currentTrack?.thumbnail && hasConsent && !failedThumbnails.has(channel.currentTrack.thumbnail) ? (
                                            <>
                                                <img
                                                    src={channel.currentTrack.thumbnail}
                                                    alt={channel.name}
                                                    className="w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity duration-500 scale-105 group-hover:scale-110 transform transition-transform"
                                                    onError={() => setFailedThumbnails(prev => new Set(prev).add(channel.currentTrack.thumbnail))}
                                                />
                                                <div className="absolute inset-0 bg-black/50 group-hover:bg-black/30 transition-colors duration-500" />
                                            </>
                                        ) : (
                                            <div className={`absolute inset-0 bg-gradient-to-br ${channel.color} opacity-20 group-hover:opacity-30 transition-opacity duration-500`} />
                                        )}
                                    </div>

                                    <div className="absolute inset-0 p-4 sm:p-6 flex flex-col justify-end z-10 w-full pointer-events-none">
                                        <div className="flex items-center justify-between pointer-events-auto">
                                            <div className="flex-1 min-w-0 pr-2">
                                                {/* Mobile: Always scroll if long */}
                                                <div className="md:hidden">
                                                    {channel.name.length > 12 ? (
                                                        <div className="overflow-hidden whitespace-nowrap w-full mask-linear-fade">
                                                            <span
                                                                className="animate-billboard inline-block pl-0"
                                                                style={{ animationDuration: `${Math.max(10, channel.name.length * 0.4)}s` }}
                                                            >
                                                                <h3 className="text-xl font-bold text-white inline">
                                                                    {channel.name}&nbsp;&nbsp;&nbsp;&nbsp;{channel.name}&nbsp;&nbsp;&nbsp;&nbsp;
                                                                </h3>
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <h3 className="text-xl font-bold text-white truncate">
                                                            {channel.name}
                                                        </h3>
                                                    )}
                                                </div>

                                                {/* Desktop: Scroll on focus */}
                                                <div className="hidden md:block">
                                                    {actualIndex === focusedIndex && channel.name.length > 15 ? (
                                                        <div className="overflow-hidden whitespace-nowrap w-full mask-linear-fade">
                                                            <span
                                                                className="animate-billboard inline-block pl-0"
                                                                style={{ animationDuration: `${Math.max(8, channel.name.length * 0.2)}s` }}
                                                            >
                                                                <h3 className="text-2xl font-bold text-orange-400 inline">
                                                                    {channel.name}&nbsp;&nbsp;&nbsp;&nbsp;{channel.name}&nbsp;&nbsp;&nbsp;&nbsp;
                                                                </h3>
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <h3 className={`text-2xl font-bold transition-colors truncate ${actualIndex === focusedIndex ? "text-orange-400" : "text-white"}`}>
                                                            {channel.name}
                                                        </h3>
                                                    )}
                                                </div>
                                            </div>
                                            <Radio className={`transition-colors flex-shrink-0 ${actualIndex === focusedIndex ? "text-white" : "text-neutral-500"}`} />
                                        </div>
                                        <p className="text-neutral-400 text-sm line-clamp-2 mt-2 pointer-events-auto">{channel.description}</p>

                                        <div className="flex items-center gap-2 pt-4 text-xs font-medium text-neutral-500 uppercase tracking-wider justify-between pointer-events-auto">
                                            <div className="flex items-center gap-2">
                                                <Users size={14} /> <span>{channel.listeners || 0} {t('lobby.live')}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-base normal-case" title={localizedCountries.find(l => l.code === channel.language_flag)?.label || 'International'}>{getFlagEmoji(channel.language_flag)}</span>
                                                {channel.is_protected && <Lock size={14} className="text-orange-500" />}
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
                        <div className="flex items-center justify-center gap-4 mt-8">
                            <button
                                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                disabled={currentPage === 1}
                                className="p-2 rounded-full bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                <ChevronLeft size={20} />
                            </button>

                            <div className="text-sm font-medium text-neutral-400">
                                Page <span className="text-white">{currentPage}</span> of <span className="text-white">{totalPages}</span>
                            </div>

                            <button
                                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                disabled={currentPage === totalPages}
                                className="p-2 rounded-full bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                <ChevronRight size={20} />
                            </button>
                        </div>
                    )
                }
            </main >

            {/* Create Room Modal */}
            {
                isCreatingRoom && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md p-6 shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-xl font-bold text-white">{t('lobby.createNewChannel')}</h3>
                                <button onClick={() => setIsCreatingRoom(false)} className="text-neutral-500 hover:text-white transition-colors">
                                    <X size={24} />
                                </button>
                            </div>

                            <form onSubmit={submitCreateRoom}>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-neutral-400 mb-1">{t('lobby.channelName')}</label>
                                        <input
                                            type="text"
                                            value={newRoomName}
                                            onChange={(e) => setNewRoomName(e.target.value.slice(0, 100))}
                                            placeholder={t('lobby.channelNamePlaceholder')}
                                            maxLength={100}
                                            className="w-full bg-[#050505] border border-neutral-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition-colors"
                                            autoFocus
                                        />
                                        <div className="flex justify-end mt-1">
                                            <span className={`text-xs ${newRoomName.length >= 100 ? 'text-red-500 font-bold' : 'text-neutral-500'}`}>
                                                {newRoomName.length}/100
                                            </span>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-neutral-400 mb-1">{t('lobby.privacy')}</label>
                                        <div className="flex gap-4">
                                            <button
                                                type="button"
                                                onClick={() => setIsPrivate(false)}
                                                className={`flex-1 p-3 rounded-xl border flex items-center justify-center gap-2 transition-all ${!isPrivate ? 'bg-orange-500/10 border-orange-500 text-orange-500' : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:bg-neutral-700'}`}
                                            >
                                                <Globe size={18} /> {t('lobby.public')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => { setIsPrivate(true); setLanguageFlag('international'); setLanguageFlagOpen(false); }}
                                                className={`flex-1 p-3 rounded-xl border flex items-center justify-center gap-2 transition-all ${isPrivate ? 'bg-orange-500/10 border-orange-500 text-orange-500' : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:bg-neutral-700'}`}
                                            >
                                                <Lock size={18} /> {t('lobby.private')}
                                            </button>
                                        </div>
                                    </div>

                                    {!isPrivate && (
                                        <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                                            <label className="block text-sm font-medium text-neutral-400 mb-1">{t('lobby.videoLanguage')}</label>
                                            <div className="relative">
                                                {languageFlagOpen ? (
                                                    <div className="w-full bg-[#050505] border border-orange-500/50 rounded-xl px-4 py-3 flex items-center gap-2">
                                                        <span className="text-lg">{getFlagEmoji(languageFlag)}</span>
                                                        <input
                                                            type="text"
                                                            className="flex-1 bg-transparent text-white text-sm focus:outline-none placeholder-neutral-500"
                                                            placeholder={t('lobby.searchCountries')}
                                                            value={createFlagSearch}
                                                            onChange={(e) => setCreateFlagSearch(e.target.value)}
                                                            autoFocus
                                                        />
                                                        <button type="button" onClick={() => { setLanguageFlagOpen(false); setCreateFlagSearch(""); }} className="text-neutral-500 hover:text-white">
                                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => { setLanguageFlagOpen(true); setCreateFlagSearch(""); }}
                                                        className="w-full bg-[#050505] border border-neutral-800 rounded-xl px-4 py-3 text-white text-left flex items-center justify-between hover:border-neutral-700 transition-colors"
                                                    >
                                                        <span className="flex items-center gap-2">
                                                            <span className="text-lg">{getFlagEmoji(languageFlag)}</span>
                                                            <span>{localizedCountries.find(l => l.code === languageFlag)?.label || 'International'}</span>
                                                        </span>
                                                        <svg className="w-4 h-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                                    </button>
                                                )}
                                                {languageFlagOpen && (
                                                    <div className="absolute z-50 mt-1 w-full bg-[#1a1a1a] border border-neutral-800 rounded-xl shadow-xl animate-in fade-in zoom-in-95 duration-150 overflow-y-auto py-1" style={{ maxHeight: '14rem' }}>
                                                        {localizedCountries.filter(lang =>
                                                            lang.code === 'international' || lang.search.includes(createFlagSearch.toLowerCase())
                                                        ).map(lang => (
                                                            <button
                                                                key={lang.code}
                                                                type="button"
                                                                onClick={() => { setLanguageFlag(lang.code); setLanguageFlagOpen(false); setCreateFlagSearch(""); }}
                                                                className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 hover:bg-neutral-800 transition-colors ${languageFlag === lang.code ? 'text-orange-500 font-bold bg-orange-500/10' : 'text-neutral-300'}`}
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
                                            <label className="block text-sm font-medium text-neutral-400 mb-1">{t('lobby.passwordOptional')}</label>
                                            <input
                                                type="text"
                                                value={createPassword}
                                                onChange={(e) => setCreatePassword(e.target.value)}
                                                placeholder={t('lobby.passwordPlaceholder')}
                                                className="w-full bg-[#050505] border border-neutral-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition-colors"
                                            />
                                        </div>
                                    )}

                                </div>

                                <div className="flex justify-end gap-3 pt-4 border-t border-neutral-800 mt-6">
                                    <button
                                        type="button"
                                        onClick={() => setIsCreatingRoom(false)}
                                        className="px-4 py-2 rounded-xl text-neutral-400 hover:text-white transition-colors font-medium"
                                    >
                                        {t('lobby.cancel')}
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={!newRoomName.trim()}
                                        className="px-6 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 text-white font-bold hover:from-orange-400 hover:to-orange-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
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
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                    <Lock size={20} className="text-orange-500" /> Private Channel
                                </h3>
                                <button onClick={() => setShowPasswordModal(false)} className="text-neutral-500 hover:text-white transition-colors">
                                    <X size={24} />
                                </button>
                            </div>

                            <form onSubmit={submitPasswordJoin} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-neutral-400 mb-1">{t('lobby.enterPassword')}</label>
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

                                <button
                                    type="submit"
                                    className="w-full px-6 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 text-white font-bold hover:from-orange-400 hover:to-orange-500 transition-all mt-2"
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
                        className="fixed inset-0 z-[50] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
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
                                            handleLogout();
                                            setShowProfileModal(false);
                                        }}
                                        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-medium transition-colors border border-black/20"
                                    >
                                        <LogOut size={18} /> {t('lobby.signOut')}
                                    </button>

                                    <div className="pt-4 border-t border-neutral-800 mt-4">
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
                                            className="flex-1 px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-medium transition-colors"
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

            <footer className="w-full max-w-5xl mt-12 py-6 border-t border-neutral-800 flex justify-center">
                <Link to="/legal" className="text-neutral-500 hover:text-orange-500 transition-colors text-sm font-medium flex items-center gap-2">
                    <Scale size={16} />
                    <span>{t('lobby.terms')}</span>
                </Link>
            </footer>
        </div >
    );
}
