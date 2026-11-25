// SPDX-License-Identifier: GPL-3.0-or-later
// Chess Trainer — Copyright (C) 2026 Shlomi Nugarker. See LICENSE and THIRD_PARTY_NOTICES.md.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startCloud } from './cloud'
import { langReady } from './i18n'

startCloud() // Google sign-in + sync (only when configured, see docs/google-login-setup.md)

void langReady.then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
)

// installable app + offline (production only: the dev server must never be served from a cache)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
