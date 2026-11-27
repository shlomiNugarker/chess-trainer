// SPDX-License-Identifier: GPL-3.0-or-later
// Chess Trainer — Copyright (C) 2026 Shlomi Nugarker. See LICENSE and THIRD_PARTY_NOTICES.md.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import './index.css'
import './sharedLine' // before App: a link to a line chooses the tab that nav.ts restores
import App from './App.tsx'
import { startCloud } from './cloud'
import { langReady } from './i18n'
import './install'
import { migrateMastery } from './legacyMastery'
import { PUZZLES_URL } from './puzzleData'

startCloud() // Google sign-in + sync (only when configured, see docs/google-login-setup.md)

const migrated = Promise.race([migrateMastery().catch(() => {}), new Promise((r) => setTimeout(r, 3000))])
void Promise.all([langReady, migrated]).then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
)

// anonymous page views, no cookies (Vercel Web Analytics; see the privacy page). Only where Vercel serves it, so a
// local build has no failing request
if (import.meta.env.PROD && import.meta.env.VITE_ON_VERCEL === '1') void import('@vercel/analytics').then(({ inject }) => inject())

// installable app + offline (production only: the dev server must never be served from a cache)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    // Play and the puzzles work offline too: a while after the page has loaded, when the browser is idle, the service
    // worker keeps the engine (1.8MB) and the puzzle file (0.7MB), not during the first visit's loading. Not with the
    // browser's "save data": then each is kept when it is first used
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
    const LATER = ['/engine/stockfish-19-lite-single.js', '/engine/stockfish-19-lite-single.wasm', PUZZLES_URL];
    const keep = () =>
      void navigator.serviceWorker.ready.then((reg) => LATER.forEach((url) => reg.active?.postMessage({ type: 'keep', url })));
    setTimeout(() => ('requestIdleCallback' in window ? requestIdleCallback(keep, { timeout: 10_000 }) : keep()), 5000);
  });
}
