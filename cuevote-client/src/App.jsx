// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import React, { lazy, Suspense, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Consent } from './contexts/ConsentContext';
import { useWebSocketContext } from './hooks/useWebSocketContext';
import { JoinWelcome } from './components/JoinWelcome';

const RoomBody = lazy(() => import('./RoomBody'));

// Without an answer (an older server, a lost message) the channel counts as a
// YouTube one, as before.
const PROVIDER_TIMEOUT_MS = 4000;

// The music source of a channel, asked over the socket before joining: only a
// YouTube channel needs the consent screen. undefined until known.
function useRoomProvider(roomId, needed) {
  const { sendMessage, lastMessage, isConnected } = useWebSocketContext();
  const [known, setKnown] = useState({ roomId: null, provider: undefined });

  useEffect(() => {
    if (!needed || !roomId || !isConnected) return;
    sendMessage({ type: 'ROOM_PROVIDER', payload: { roomId } });
  }, [needed, roomId, isConnected, sendMessage]);

  useEffect(() => {
    if (!needed || !roomId) return undefined;
    const timer = setTimeout(() => {
      setKnown(prev => (prev.roomId === roomId ? prev : { roomId, provider: 'youtube' }));
    }, PROVIDER_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [needed, roomId]);

  useEffect(() => {
    if (lastMessage?.type === 'ROOM_PROVIDER' && lastMessage.payload?.roomId === roomId) {
      setKnown({ roomId, provider: lastMessage.payload.provider === 'apple' ? 'apple' : 'youtube' });
    }
  }, [lastMessage, roomId]);

  return known.roomId === roomId ? known.provider : undefined;
}

function App() {
  const { roomId } = useParams();
  const { hasConsent, giveConsent } = Consent.useConsent();
  // With the YouTube consent the room opens at once, as before. An Apple Music
  // channel opens without a consent screen: a guest loads nothing from Apple
  // until they turn its cover art and previews on inside the channel.
  const provider = useRoomProvider(roomId, !hasConsent);

  if (!hasConsent) {
    if (provider === undefined) return <JoinWelcome provider={null} />;
    if (provider !== 'apple') return <JoinWelcome provider="youtube" onAccept={giveConsent} />;
  }

  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <span className="text-neutral-500">Loading…</span>
      </div>
    }>
      <RoomBody />
    </Suspense>
  );
}
export default App;
