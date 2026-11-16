// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { WebSocketContext } from './WebSocketContext';

const getWebSocketUrl = () => {
  const envUrl = import.meta.env.VITE_WS_URL;
  if (envUrl) return envUrl;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const hostname = window.location.hostname;

  // Development / Localhost: Default to port 8080
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '10.0.2.2') {
    return `${protocol}//${hostname}:8080`;
  }

  // Production (cuevote.com): Use same host, standard ports (handled by Nginx/Proxy)
  return `${protocol}//${hostname}/ws`;
};

const WEBSOCKET_URL = getWebSocketUrl();
const SESSION_KEY = "cuevote_session_token";
// A guest identity is signed by the server and carries nothing personal, so it
// lives in localStorage like the session token and survives a reload — that is
// what keeps a guest's votes theirs when they lock their phone mid-party.
const GUEST_KEY = "cuevote_guest_token";
const ACKABLE_TYPES = ["VOTE", "SUGGEST_SONG", "JOIN_ROOM", "LOGIN", "RESUME_SESSION", "GUEST_SESSION"];
const QUEUEABLE_TYPES = ["VOTE", "SUGGEST_SONG", "JOIN_ROOM", "PLAY_PAUSE", "NEXT_TRACK", "LOGIN", "RESUME_SESSION", "GUEST_SESSION"];

// Claims a guest identity: the stored one if this device has been a guest
// before, otherwise a fresh one from the server.
const guestSessionMessage = (guestToken) => JSON.stringify({
  type: "GUEST_SESSION",
  payload: guestToken ? { token: guestToken } : {},
});

export function WebSocketProvider({ children }) {
  const [state, setState] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastError, setLastError] = useState(null);
  const [lastErrorCode, setLastErrorCode] = useState(null);
  const [lastErrorTimestamp, setLastErrorTimestamp] = useState(0);
  const errorClearTimer = useRef(null);
  const [lastMessage, setLastMessage] = useState(null);
  const [user, setUser] = useState(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [connectionQuality, setConnectionQuality] = useState('good');
  const sessionTokenRef = useRef(localStorage.getItem(SESSION_KEY));
  const guestTokenRef = useRef(localStorage.getItem(GUEST_KEY));
  // A guest identity is claimed when a room is joined, not on page load: the
  // lobby needs none, and a visitor who only looks around should not get an id
  // stored on their device. Set by the first JOIN_ROOM of this page and kept,
  // so reconnects, a logout or an expired session inside a room re-claim one.
  const joinedRoomRef = useRef(false);
  // Mirrors `user` for code that runs outside React's render (sendMessage).
  const userRef = useRef(null);
  const [clientId] = useState(() => {
    let id = localStorage.getItem("cuevote_client_id");
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `user-${Date.now()}-${Math.random()}`;
      localStorage.setItem("cuevote_client_id", id);
    }
    const tabId = sessionStorage.getItem("cuevote_tab_id") ||
      (crypto.randomUUID ? crypto.randomUUID() : `tab-${Date.now()}-${Math.random()}`);
    sessionStorage.setItem("cuevote_tab_id", tabId);
    return `${id}_${tabId}`;
  });

  const ws = useRef(null);
  const messageQueue = useRef([]);
  const pendingAcks = useRef(new Map());
  const ackCounter = useRef(0);
  const progressRef = useRef(0);
  // When progressRef last came from the server: it arrives every few seconds,
  // and a player comparing against it has to add the time since.
  const progressAtRef = useRef(0);
  // Apple rooms: whether this socket is the room's player (true), on standby
  // (false), or not told yet (null). Kept here, not in lastMessage, which a
  // following message can overwrite before anyone reads it.
  const [applePlayerLease, setApplePlayerLease] = useState(null);
  const leaseRoomRef = useRef(null);

  const sendMessage = useCallback((message) => {
    if (message.type === "JOIN_ROOM") {
      joinedRoomRef.current = true;
      // Entering a room without an account: claim the guest identity first, on
      // the same socket, so the first tap on a vote button works. A socket that
      // is not open yet gets it from handleOpen, ahead of the queued JOIN_ROOM.
      if (!sessionTokenRef.current && !userRef.current && ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(guestSessionMessage(guestTokenRef.current));
      }
    }

    const isAckable = ACKABLE_TYPES.includes(message.type);
    if (isAckable) {
      const msgId = `${++ackCounter.current}`;
      message = { ...message, msgId };
      pendingAcks.current.set(msgId, { message, timestamp: Date.now() });
      setTimeout(() => { pendingAcks.current.delete(msgId); }, 10000);
    }

    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    } else if (QUEUEABLE_TYPES.includes(message.type)) {
      if (messageQueue.current.length < 50) {
        messageQueue.current.push(message);
      }
    }
  }, []);

  const handleLoginSuccess = useCallback((tokenResponse) => {
    if (import.meta.env.DEV) {
      console.log("Sending Access Token to Backend...", tokenResponse);
    }
    sendMessage({ type: "LOGIN", payload: { token: tokenResponse.access_token } });
  }, [sendMessage]);

  const handleLogout = useCallback(() => {
    const token = sessionTokenRef.current;
    if (token) {
      sendMessage({ type: "LOGOUT", payload: { token } });
      sessionTokenRef.current = null;
      localStorage.removeItem(SESSION_KEY);
    }
    setUser(null);
    userRef.current = null;
    // Signing out drops the account, not the ability to take part: pick the
    // guest identity back up so voting keeps working in an open room.
    if (joinedRoomRef.current) {
      sendMessage({
        type: "GUEST_SESSION",
        payload: guestTokenRef.current ? { token: guestTokenRef.current } : {},
      });
    }
  }, [sendMessage]);

  useEffect(() => {
    let reconnectTimeout = null;
    let reconnectDelay = 1000;
    const MAX_RECONNECT_DELAY = 10000;
    let lastResumeTime = 0;
    // Set on unmount. The close event of the socket we close in the cleanup
    // arrives AFTER the cleanup ran, and handleClose would otherwise schedule
    // a reconnect from this dead closure — a zombie connection that shares
    // our persisted clientId and evicts the next provider instance's socket
    // in an endless fight (e.g. after the consent flip remounts the tree).
    let disposed = false;

    let activePingInterval = null;
    let activeVisibilityHandler = null;
    let activeOnlineHandler = null;

    const cleanupConnectionListeners = () => {
      if (activePingInterval) { clearInterval(activePingInterval); activePingInterval = null; }
      if (activeVisibilityHandler) { document.removeEventListener('visibilitychange', activeVisibilityHandler); activeVisibilityHandler = null; }
      if (activeOnlineHandler) { window.removeEventListener('online', activeOnlineHandler); activeOnlineHandler = null; }
    };

    const connect = () => {
      if (disposed) return;
      cleanupConnectionListeners();

      const wsUrl = new URL(WEBSOCKET_URL);
      wsUrl.searchParams.append("clientId", clientId);

      const socket = new WebSocket(wsUrl.toString());
      ws.current = socket;

      const handleOpen = () => {
        console.log("WebSocket connected");
        setIsConnected(true);
        const token = sessionTokenRef.current;
        if (token) {
          socket.send(JSON.stringify({ type: "RESUME_SESSION", payload: { token } }));
        } else if (joinedRoomRef.current) {
          // Nobody is signed in and this page is (or was) in a room: claim the
          // guest identity before the queued JOIN_ROOM goes out, so the first
          // tap on a vote button works instead of bouncing off an auth wall.
          socket.send(guestSessionMessage(guestTokenRef.current));
        }
        while (messageQueue.current.length > 0) {
          const queued = messageQueue.current.shift();
          socket.send(JSON.stringify(queued));
        }
        // Only reset the backoff after the socket survives 10s. Without this, a server
        // that closes immediately after opening (e.g. rate limit at server/index.js:169)
        // keeps resetting reconnectDelay back to 1s, sustaining a 1-2s reload loop.
        socket._stabilityTimer = setTimeout(() => {
          setReconnectAttempt(0);
          reconnectDelay = 1000;
        }, 10000);
      };

      const handleClose = (event) => {
        console.log("WebSocket disconnected", { code: event?.code, reason: event?.reason, wasClean: event?.wasClean });
        if (socket._stabilityTimer) clearTimeout(socket._stabilityTimer);
        // Late close from a socket that connect() has already replaced — the
        // resume/online handlers reconnect while a dead socket is still in
        // CLOSING, so its close can arrive after the next socket went live.
        // It must not tear down the live socket's shared listeners, flip
        // isConnected, or schedule another connect: the server evicts
        // same-clientId sockets, so that extra connect starts an endless
        // evict/reconnect fight (sibling of the disposed guard below).
        if (ws.current !== socket) return;
        cleanupConnectionListeners();
        if (disposed) return; // provider unmounted — don't resurrect the connection
        setIsConnected(false);
        setReconnectAttempt(prev => prev + 1);
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connect, reconnectDelay);
        const jitter = Math.random() * 0.3 * reconnectDelay;
        reconnectDelay = Math.min(reconnectDelay * 2 + jitter, MAX_RECONNECT_DELAY);
      };

      const handleError = (error) => {
        console.error("WebSocket error:", error);
      };

      const handleMessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === "PONG") {
            const latency = Date.now() - (socket.lastPingSent || Date.now());
            socket.lastPong = Date.now();
            if (latency < 300) setConnectionQuality('good');
            else if (latency < 1000) setConnectionQuality('fair');
            else setConnectionQuality('poor');
            return;
          }

          if (message.type === "ACK") {
            pendingAcks.current.delete(message.msgId);
            return;
          }

          if (message.type === "state") {
            setState(message.payload);
            progressRef.current = message.payload.progress || 0;
            progressAtRef.current = Date.now();
            // Another room: its player has yet to be settled.
            if (message.payload?.roomId !== leaseRoomRef.current) {
              leaseRoomRef.current = message.payload?.roomId ?? null;
              setApplePlayerLease(null);
            }
          } else if (message.type === "state_delta") {
            setState(prev => prev ? { ...prev, ...message.payload } : message.payload);
            if ('progress' in message.payload) {
              progressRef.current = message.payload.progress || 0;
              progressAtRef.current = Date.now();
            }
          } else if (message.type === "progress") {
            progressRef.current = message.payload;
            progressAtRef.current = Date.now();
          } else if (message.type === "APPLE_PLAYER_LEASE") {
            setApplePlayerLease(!!message.payload?.active);
          } else if (message.type === "LOGIN_SUCCESS") {
            // Auth handled inline rather than via setLastMessage, because the
            // shared `lastMessage` state can be overwritten by a subsequent
            // message (e.g. ROOM_LIST arriving microseconds after LOGIN_SUCCESS)
            // before its useEffect runs, silently dropping the auth update
            // under React 18 auto-batching. Observed on Safari with multi-tab
            // reconnect storms: server logged "Resume Session OK" every time,
            // but the client never showed the user as logged in.
            if (import.meta.env.DEV) {
              console.log("Backend Login Success:", message.payload.user);
            }
            setUser(message.payload.user);
            userRef.current = message.payload.user;
            if (message.payload.sessionToken) {
              sessionTokenRef.current = message.payload.sessionToken;
              localStorage.setItem(SESSION_KEY, message.payload.sessionToken);
            }
          } else if (message.type === "GUEST_SESSION_OK") {
            // Same inline handling as LOGIN_SUCCESS, and for the same reason:
            // routing identity through `lastMessage` loses it to batching.
            if (message.payload.guestToken) {
              guestTokenRef.current = message.payload.guestToken;
              localStorage.setItem(GUEST_KEY, message.payload.guestToken);
            }
            setUser(message.payload.user);
            userRef.current = message.payload.user;
          } else if (message.type === "SESSION_INVALID") {
            console.warn("Session Invalid/Expired");
            sessionTokenRef.current = null;
            localStorage.removeItem(SESSION_KEY);
            setUser(null);
            userRef.current = null;
            // An expired session must not drop someone in a room back to having
            // no identity at all — fall back to a guest one.
            if (joinedRoomRef.current && socket.readyState === WebSocket.OPEN) {
              socket.send(guestSessionMessage(guestTokenRef.current));
            }
          } else {
            setLastMessage(message);
            if (message.type === "error") {
              if (errorClearTimer.current) clearTimeout(errorClearTimer.current);
              setLastError(message.message);
              setLastErrorCode(message.code || null);
              setLastErrorTimestamp(Date.now());
              console.warn("[CLIENT TRACE] <<< ERROR:", message.message);
              errorClearTimer.current = setTimeout(() => {
                setLastError(null);
                setLastErrorCode(null);
                errorClearTimer.current = null;
              }, 5000);
            }
          }
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
          if (errorClearTimer.current) clearTimeout(errorClearTimer.current);
          setLastError("JSON PARSE ERROR: " + error.message);
          setLastErrorTimestamp(Date.now());
          errorClearTimer.current = setTimeout(() => {
            setLastError(null);
            setLastErrorCode(null);
            errorClearTimer.current = null;
          }, 5000);
        }
      };

      socket.addEventListener("open", handleOpen);
      socket.addEventListener("close", handleClose);
      socket.addEventListener("error", handleError);
      socket.addEventListener("message", handleMessage);

      socket.lastPong = Date.now();
      let wasHidden = false;

      const pingInterval = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          if (wasHidden) return;

          socket.lastPingSent = Date.now();
          socket.send(JSON.stringify({ type: "PING" }));

          const now = Date.now();
          const inGracePeriod = lastResumeTime > 0 && (now - lastResumeTime < 15000);
          if (!inGracePeriod && socket.lastPong && (now - socket.lastPong > 12000)) {
            console.warn("[WS] Heartbeat timeout! No PONG in 12s. Force closing.");
            socket.close();
          }
        }
      }, 5000);
      activePingInterval = pingInterval;

      const handleResume = () => {
        lastResumeTime = Date.now();

        if (socket.readyState === WebSocket.OPEN) {
          try {
            socket.send(JSON.stringify({ type: "PING" }));
          } catch { /* socket may be closing */ }

          setTimeout(() => {
            if (socket.readyState !== WebSocket.OPEN) return;
            if (Date.now() - (socket.lastPong || 0) > 8000) {
              console.warn("[WS] Connection stale after resume. Reconnecting.");
              socket.close();
            }
          }, 4000);
        } else if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
          if (reconnectTimeout) clearTimeout(reconnectTimeout);
          reconnectDelay = 1000;
          reconnectTimeout = setTimeout(connect, 500);
        }
      };

      const handleVisibilityChange = () => {
        if (!document.hidden) {
          wasHidden = false;
          handleResume();
        } else {
          wasHidden = true;
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
      activeVisibilityHandler = handleVisibilityChange;

      const handleOnline = () => {
        console.log("[WS] Browser came back online. Reconnecting immediately.");
        if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
          if (reconnectTimeout) clearTimeout(reconnectTimeout);
          reconnectDelay = 1000;
          reconnectTimeout = setTimeout(connect, 300);
        } else if (socket.readyState === WebSocket.OPEN) {
          handleResume();
        }
      };
      window.addEventListener('online', handleOnline);
      activeOnlineHandler = handleOnline;

      window.cuevoteReconnect = handleResume;
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      cleanupConnectionListeners();
      delete window.cuevoteReconnect;
      if (ws.current) {
        try { ws.current.close(); } catch { /* already closed */ }
      }
    };
  }, [clientId]);

  return (
    <WebSocketContext.Provider value={{ state, isConnected, sendMessage, lastError, lastErrorCode, lastErrorTimestamp, lastMessage, clientId, user, handleLoginSuccess, handleLogout, clearMessage: () => setLastMessage(null), reconnectAttempt, forceReconnect: () => { if (window.cuevoteReconnect) window.cuevoteReconnect(); }, connectionQuality, progressRef, progressAtRef, applePlayerLease }}>
      {children}
    </WebSocketContext.Provider>
  );
}
