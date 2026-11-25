// Where the user is: the tab, and what is open on top of it. Kept in the browser's history, so the Back button
// (or gesture) of a phone closes a panel, leaves a game review or returns to the tab before, instead of leaving
// the app. Closing something from the screen goes back to the entry before it when that is the same place, so
// the history does not grow from opening and closing.

import { useSyncExternalStore } from 'react';
import { readStored } from './storage';

export type Screen = 'play' | 'learn' | 'review' | 'drill';

export type Nav = {
  screen: Screen;
  review: string | null; // the game under review (its url)
  account: boolean; // the account panel
  sheet: boolean; // the settings sheet of Play (phones)
};
type Entry = { nav: Nav; prev: Nav | null };

const SCREENS: Screen[] = ['play', 'learn', 'review', 'drill'];
const isEntry = (x: unknown): x is Entry => SCREENS.includes((x as Entry | null)?.nav?.screen as Screen);
const same = (a: Nav, b: Nav) => a.screen === b.screen && a.review === b.review && a.account === b.account && a.sheet === b.sheet;

const stored = readStored<Screen>('screen', 'learn'); // first visit starts at Learn; then the last tab
let shown: Nav = { screen: SCREENS.includes(stored) ? stored : 'learn', review: null, account: false, sheet: false };
let entry: Entry = { nav: shown, prev: null }; // the current history entry
let backing = false; // history.back() was called and has not arrived yet
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

/** Makes the history agree with what is shown. */
function settle() {
  if (backing || same(shown, entry.nav)) return;
  if (entry.prev && same(entry.prev, shown)) {
    backing = true;
    history.back();
  } else {
    entry = { nav: shown, prev: entry.nav };
    history.pushState(entry, '');
  }
}

history.replaceState(entry, '');
window.addEventListener('popstate', (e) => {
  entry = isEntry(e.state) ? e.state : { nav: shown, prev: null };
  if (backing) {
    backing = false;
    settle(); // something else may have been opened meanwhile
    return;
  }
  shown = entry.nav;
  emit();
});

export function go(to: Partial<Nav>) {
  const next = { ...shown, ...to };
  if (same(next, shown)) return;
  shown = next;
  emit();
  settle();
}

export const goTo = (screen: Screen) => go({ screen, account: false, sheet: false });

export function useNav(): Nav {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => shown,
  );
}
