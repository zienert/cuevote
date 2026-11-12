// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Julian Zienert
import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { WebSocketProvider } from './contexts/WebSocketProvider.jsx';
import './index.css'
import { Lobby } from './components/Lobby.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'

const App = lazy(() => import('./App.jsx'))
const LegalPage = lazy(() => import('./components/LegalPage.jsx').then(m => ({ default: m.LegalPage })))
const ConnectAI = lazy(() => import('./components/ConnectAI.jsx').then(m => ({ default: m.ConnectAI })))
// DEV-only: preview Android Venue Mode + the app-download footer without a backend.
const AndroidVenuePreview = import.meta.env.DEV ? lazy(() => import('./components/__AndroidVenuePreview.jsx')) : null;
// DEV-only: does this browser play full Apple Music videos and start the next one without a click?
const AppleMusicLab = import.meta.env.DEV ? lazy(() => import('./components/__AppleMusicLab.jsx')) : null;

import { Consent } from './contexts/ConsentContext.jsx';
import { Language } from './contexts/LanguageContext.jsx';
import { ConditionalGoogleOAuthProvider } from './components/ConditionalGoogleOAuthProvider.jsx';

import { MobileRedirectGuard } from './components/MobileRedirectGuard.jsx';
// ... previous imports

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <Consent.ConsentProvider>
      <Language.LanguageProvider>
        <BrowserRouter>
          <MobileRedirectGuard>
            <ConditionalGoogleOAuthProvider>
              <WebSocketProvider>
                <Routes>
                  {import.meta.env.DEV && AndroidVenuePreview ? (
                    <Route path="/__android-preview" element={<Suspense fallback={null}><AndroidVenuePreview /></Suspense>} />
                  ) : null}
                  {import.meta.env.DEV && AppleMusicLab ? (
                    <Route path="/__apple-music-lab" element={<Suspense fallback={null}><AppleMusicLab /></Suspense>} />
                  ) : null}
                  <Route path="/room/:roomId" element={<Suspense fallback={<div className="min-h-screen bg-[#050505] flex items-center justify-center"><span className="text-neutral-500">Loading…</span></div>}><App /></Suspense>} />
                  <Route path="/legal" element={<Suspense fallback={<div className="min-h-screen bg-[#050505]" />}><LegalPage /></Suspense>} />
                  <Route path="/connect-ai" element={<Suspense fallback={<div className="min-h-screen bg-[#050505]" />}><ConnectAI /></Suspense>} />
                  <Route path="/" element={<Lobby />} />
                </Routes>
              </WebSocketProvider>
            </ConditionalGoogleOAuthProvider>
          </MobileRedirectGuard>
        </BrowserRouter>
      </Language.LanguageProvider>
    </Consent.ConsentProvider>
  </ErrorBoundary>,
)
