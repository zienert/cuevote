// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
//
// OAuth consent page for the remote DJ MCP. An AI client sends the user here
// (?auth=<handle>). The user signs in (existing Google flow) and approves; we
// send MCP_AUTHORIZE over the authenticated socket — the server finalizes with
// the MCP and returns a redirect back to the AI client. The finalize secret
// stays server-side; this page never sees it.
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { useWebSocketContext } from '../hooks/useWebSocketContext';
import { Language } from '../contexts/LanguageContext';
import { GoogleAuthButton } from './GoogleAuthButton';
import { GoogleGIcon } from './GoogleGIcon';
import { deviceDetection } from '../utils/deviceDetection';
import { isSignedIn } from '../utils/participation';

// Hosts that may be loaded inside the native wrapper. Everything else has to go
// to a real browser: the wrapper shows no address bar and keeps a native Google
// login bridge on window.webkit, so a foreign page loaded there is both
// unrecognisable as foreign and within reach of the user's access token.
const CUEVOTE_HOSTS = new Set(['cuevote.com', 'www.cuevote.com']);

function isExternalHost(host) {
  return !!host && !CUEVOTE_HOSTS.has(host.toLowerCase());
}

export function ConnectAI() {
  const [params] = useSearchParams();
  const handle = params.get('auth');
  const clientName = params.get('client');
  const redirectHost = params.get('redirect');
  const { t } = Language.useLanguage();
  const { user, isConnected, sendMessage, lastMessage, handleLoginSuccess, clearMessage } = useWebSocketContext();
  const [phase, setPhase] = useState('idle'); // idle | submitting | success | denied | error | handoff
  const [handoffHost, setHandoffHost] = useState('');

  // The `redirect` hint is only a hint — the AI client picked it and an attacker
  // crafting the link can leave it out. It is good enough to stop the flow early
  // (before the one-shot handle is spent, so the user can redo this in a
  // browser), but the authoritative check is on the URL the server hands back.
  const inNativeWrapper = deviceDetection.isNativeApp();

  // React to the server's reply on the shared socket.
  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type === 'MCP_AUTHORIZE_RESULT' && lastMessage.payload?.redirectTo) {
      const target = lastMessage.payload.redirectTo;
      let host = '';
      try { host = new URL(target, window.location.origin).host; } catch { /* keep '' */ }

      // Follow the code only to the host this page showed. The MCP checks the
      // same before it issues a code; this keeps the page from relying on it.
      if (host !== (redirectHost || '')) {
        setPhase('error');
        return;
      }

      if (inNativeWrapper && isExternalHost(host)) {
        setHandoffHost(host);
        setPhase('handoff');
        return;
      }
      setPhase('success');
      window.location.href = target;
    } else if (lastMessage.type === 'error' && phase === 'submitting') {
      setPhase('error');
    }
  }, [lastMessage, phase, inNativeWrapper, redirectHost]);

  const approve = () => {
    if (!handle || !user) return;
    clearMessage(); // drop any stale error so the effect only reacts to THIS request's reply
    setPhase('submitting');
    // Echo what this page displayed: the MCP issues a code only if it matches.
    sendMessage({ type: 'MCP_AUTHORIZE', payload: { handle, shownClient: clientName || '', shownHost: redirectHost || '' } });
  };

  // If neither result nor error comes back, don't leave the button stuck.
  useEffect(() => {
    if (phase !== 'submitting') return;
    const t = setTimeout(() => setPhase('error'), 15000);
    return () => clearTimeout(t);
  }, [phase]);

  const Card = ({ children }) => (
    <div className="min-h-screen bg-[#050505] text-neutral-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        {/* CueVote brand wordmark — orange is the product's signature color. */}
        <h1 className="mb-5 text-center text-3xl font-bold tracking-tight text-orange-500">CueVote</h1>
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-7 shadow-2xl">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-orange-500/30 bg-orange-500/10">
              <Sparkles className="h-5 w-5 text-orange-500" />
            </span>
            <h2 className="text-base font-semibold text-neutral-100">{t('connectAi.title')}</h2>
          </div>
          {children}
        </div>
      </div>
    </div>
  );

  // Invalid / missing handle.
  if (!handle) {
    return <Card><p className="text-neutral-400">{t('connectAi.invalidLink')}</p></Card>;
  }

  // Refuse before the handle is spent when the hint already shows the flow would
  // end on a foreign host. The consent screen is not even offered — nothing here
  // can be completed inside the wrapper.
  if (phase === 'handoff' || (inNativeWrapper && isExternalHost(redirectHost))) {
    return (
      <Card>
        <p className="mb-3 font-semibold text-neutral-100">{t('connectAi.openInBrowserTitle')}</p>
        <p className="text-neutral-400">
          {t('connectAi.openInBrowserDesc', { host: handoffHost || redirectHost })}
        </p>
      </Card>
    );
  }

  // Terminal states.
  if (phase === 'success') {
    return <Card><p className="text-emerald-400">{t('connectAi.success')}</p></Card>;
  }
  if (phase === 'denied') {
    return <Card><p className="text-neutral-400">{t('connectAi.denied')}</p></Card>;
  }

  // Not signed in yet → offer Google sign-in. A guest identity is not an
  // account: the grant is meant to let an AI act in a person's name, and the
  // server refuses to finalize one for a guest.
  if (!isSignedIn(user)) {
    return (
      <Card>
        <p className="mb-6 text-neutral-400">{t('connectAi.signInDesc')}</p>
        <GoogleAuthButton
          onLoginSuccess={handleLoginSuccess}
          render={(login, disabled) => (
            <button
              onClick={() => login()}
              disabled={disabled}
              className={`flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 font-medium text-neutral-900 transition hover:bg-neutral-200 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <GoogleGIcon className="h-5 w-5" />
              {t('lobby.signInGoogle')}
            </button>
          )}
        />
      </Card>
    );
  }

  // Signed in → consent.
  return (
    <Card>
      <p className="mb-2 text-neutral-300">{t('connectAi.permissionDesc')}</p>
      {/* Always show the trust box in the consent state. Registration is open, so
          `client` is whatever the requester typed — "CueVote Official" is as
          available to an attacker as anything else. The redirect HOST is the one
          value CueVote can vouch for (the code goes there and nowhere else), so
          it is what the box leads with; the self-chosen name sits underneath,
          labelled as a claim. When there is no host at all (native/custom-scheme
          client) we still warn generically rather than showing a bare screen. */}
      <div className="mb-4 rounded-lg border border-amber-700/40 bg-amber-950/30 px-3 py-2.5 text-sm text-amber-200">
        {redirectHost ? (
          <>
            <p className="text-xs uppercase tracking-wide text-amber-400/80">{t('connectAi.willSendTo')}</p>
            <p className="mt-0.5 mb-2 break-all font-mono text-base font-semibold text-amber-100">{redirectHost}</p>
            <p className="text-xs leading-relaxed text-amber-300/90">
              {t('connectAi.clientClaimsUnverified', { client: clientName || '—' })}
            </p>
          </>
        ) : (
          t('connectAi.requestedByNoHost')
        )}
      </div>
      <p className="mb-6 text-sm text-neutral-500">
        {t('connectAi.signedInAs', { name: user.name || user.email || '—' })}
      </p>
      {phase === 'error' && (
        <p className="mb-4 rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">{t('connectAi.error')}</p>
      )}
      <div className="flex gap-3">
        <button
          onClick={() => setPhase('denied')}
          disabled={phase === 'submitting'}
          className="flex-1 rounded-xl border border-neutral-700 px-4 py-3 font-medium text-neutral-300 transition hover:bg-neutral-800"
        >
          {t('lobby.cancel')}
        </button>
        <button
          onClick={approve}
          disabled={phase === 'submitting' || !isConnected}
          className="flex-1 rounded-xl bg-orange-500 px-4 py-3 font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-600 disabled:opacity-50 disabled:shadow-none"
        >
          {phase === 'submitting' ? t('connectAi.connecting') : t('connectAi.allow')}
        </button>
      </div>
      {!isConnected && <p className="mt-4 text-center text-xs text-neutral-500">{t('connectAi.waiting')}</p>}
    </Card>
  );
}

export default ConnectAI;
