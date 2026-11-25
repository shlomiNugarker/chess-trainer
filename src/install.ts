// Installing the app (PWA): the browser's own dialog where there is one (Chrome and Edge), the steps on an iPhone or an
// iPad, and nothing where the app is already installed or cannot be.

import { createStore } from './createStore';
import { readStored, writeStored } from './storage';

/** Chrome's event; its type is not in TypeScript's DOM. */
type InstallPrompt = Event & { prompt: () => Promise<unknown>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const installed = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
/** An iPad says it is a Mac. The browsers inside other apps have no "Add to Home Screen". */
const ios = () =>
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)) &&
  !/FBAN|FBAV|Instagram|Line\//.test(navigator.userAgent);

let event: InstallPrompt | null = null;
/** How the app can be installed here: null — it cannot, or it already is. */
const how = createStore<'prompt' | 'ios' | null>(!installed() && ios() ? 'ios' : null);
/** "Not now", on this device: the card does not come back (the button in the account panel stays). */
const declined = createStore(readStored('install-declined', false));

export const useInstall = how.use;
export const useDeclined = declined.use;

export function declineInstall() {
  writeStored('install-declined', true);
  declined.set(true);
}

// the event comes once, soon after the page loads: this module is loaded with the app (main.tsx)
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // not the browser's own bar: the app offers it, at a better time
  event = e as InstallPrompt;
  how.set('prompt');
});
window.addEventListener('appinstalled', () => how.set(null));

/** Opens the browser's dialog. An event opens it only once; Chrome sends another one when it may be asked again. */
export async function install() {
  const e = event;
  if (!e) return;
  event = null;
  how.set(null);
  try {
    await e.prompt();
    if ((await e.userChoice).outcome === 'dismissed') declineInstall();
  } catch {
    /* the browser did not open it — nothing to do */
  }
}
