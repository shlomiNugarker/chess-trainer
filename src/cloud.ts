// Google sign-in and syncing progress between devices. Light module: Firebase itself (firebase.ts) is loaded
// only when the user signs in or is already signed in. Every save to localStorage is noticed in one place
// (a wrapper around setItem), stamped, and uploaded a few seconds later; the cloud copy is merged in on
// sign-in, on start and when the app comes back to the foreground.

import { useSyncExternalStore } from 'react';
import { cloudEnabled } from './cloudConfig';
import { PREFIX, asNewDevice, isSynced, mergeSides, type Side } from './syncMerge';
import type { CloudUser } from './firebase';

export type CloudStatus = 'idle' | 'signing-in' | 'syncing' | 'synced' | 'offline' | 'error';
export type CloudState = { enabled: boolean; user: CloudUser | null; status: CloudStatus; lastSync: number | null };

const SIGNED_IN = PREFIX + 'cloud-signed-in';
const SIGNING_IN = PREFIX + 'cloud-signing-in';
const STAMPS = PREFIX + 'sync-stamps';
const LAST_SYNC = PREFIX + 'cloud-last-sync';
const PUSH_DELAY = 3000;

const nativeSet = Storage.prototype.setItem;
const get = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const set = (k: string, v: string) => {
  try {
    nativeSet.call(localStorage, k, v); // never stamped
  } catch {
    /* storage unavailable — ignore */
  }
};
const remove = (k: string) => {
  try {
    localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
};

let state: CloudState = { enabled: cloudEnabled, user: null, status: 'idle', lastSync: Number(get(LAST_SYNC)) || null };
const listeners = new Set<() => void>();
const update = (patch: Partial<CloudState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function useCloud(): CloudState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

// ---- noticing local changes ----

const readStamps = (): Record<string, number> => {
  try {
    return JSON.parse(get(STAMPS) ?? '{}');
  } catch {
    return {};
  }
};

let pushTimer: number | undefined;

function installHook() {
  Storage.prototype.setItem = function (key: string, value: string) {
    const watched = this === localStorage && isSynced(key);
    const unchanged = watched && this.getItem(key) === value;
    nativeSet.call(this, key, value);
    // rewriting the same value is not a change: otherwise a device that is behind becomes "newer" and
    // overwrites the other device's change
    if (!watched || unchanged) return;
    const stamps = readStamps();
    stamps[key] = Date.now();
    set(STAMPS, JSON.stringify(stamps));
    if (state.user) {
      clearTimeout(pushTimer);
      pushTimer = window.setTimeout(() => void sync(false), PUSH_DELAY);
    }
  };
}

// ---- Firebase, loaded on demand ----

let fbPromise: Promise<typeof import('./firebase')> | null = null;
/** Firebase did not load (offline, or an old page asking for a file that a new deploy replaced). */
let loadFailed = false;
/** A sign-in window is open in this page right now (its result is still to come). */
let signInOpen = false;

function firebase() {
  fbPromise ??= import('./firebase').then(
    (fb) => {
      loadFailed = false;
      fb.watchUser((user) => {
        update({ user });
        if (user) {
          set(SIGNED_IN, '1');
          remove(SIGNING_IN);
          void sync(true);
        } else {
          remove(SIGNED_IN);
          // no user and no sign-in window open: also the end of a redirect sign-in the user cancelled
          if (!signInOpen) {
            remove(SIGNING_IN);
            update({ status: 'idle' });
          }
        }
      });
      return fb;
    },
    (e) => {
      loadFailed = true;
      fbPromise = null; // some browsers fetch the file again; Chrome remembers the failure until a reload (signIn)
      throw e;
    },
  );
  return fbPromise;
}

/** Called once at startup. */
export function startCloud() {
  if (!cloudEnabled) return;
  installHook();
  // reconnect a signed-in user (or finish a redirect sign-in) without making everyone else load Firebase
  if (get(SIGNED_IN) || get(SIGNING_IN)) {
    if (get(SIGNING_IN)) update({ status: 'signing-in' });
    firebase().catch(() => update({ status: navigator.onLine ? 'error' : 'offline' }));
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.user) void sync(true);
  });
  window.addEventListener('online', () => state.user && void sync(false));
  // back from Google's page without signing in, and the browser shows this page as it was (not loaded again)
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted || state.user || state.status !== 'signing-in') return;
    signInOpen = false;
    remove(SIGNING_IN);
    update({ status: 'idle' });
  });
}

/** Loads Firebase ahead of a likely sign-in (the account panel opened), so the Google window opens at once. */
export function preloadCloud() {
  if (cloudEnabled) firebase().catch(() => {}); // signIn() tries again and reports the error
}

export async function signIn() {
  // the user tries again after "sign-in did not work" because Firebase could not load: only a fresh page helps
  if (loadFailed && state.status === 'error') {
    location.reload();
    return;
  }
  update({ status: 'signing-in' });
  set(SIGNING_IN, '1'); // survives the redirect on phones
  signInOpen = true;
  try {
    const fb = await firebase();
    await fb.signIn();
  } catch {
    remove(SIGNING_IN);
    update({ status: state.user ? 'synced' : 'error' });
  } finally {
    signInOpen = false;
  }
}

export async function signOut() {
  clearTimeout(pushTimer);
  try {
    const fb = await firebase();
    await fb.signOut();
  } catch {
    update({ status: navigator.onLine ? 'error' : 'offline' });
    return;
  }
  remove(SIGNED_IN);
  update({ user: null, status: 'idle' });
}

// ---- syncing ----

let running: Promise<void> | null = null;
/** Another sync was asked for while one was running (null: none); true if any of them asked to reload. */
let again: boolean | null = null;

function localSide(): Side {
  const data: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (isSynced(k)) data[k] = localStorage.getItem(k)!;
  }
  return { data, stamps: readStamps() };
}

// Firestore field names: store the keys without the prefix
const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.slice(PREFIX.length), v]));
const addPrefix = <T>(o: Record<string, T> = {}) => Object.fromEntries(Object.entries(o).map(([k, v]) => [PREFIX + k, v])) as Record<string, T>;

/**
 * Merge the cloud copy into this device and upload the result. With `reloadOnChange`, a change that came
 * from the other device reloads the page once so every screen shows it (only at moments when nothing is
 * in progress: sign-in, start, coming back to the app).
 */
export function sync(reloadOnChange: boolean): Promise<void> {
  if (running) {
    again = (again ?? false) || reloadOnChange;
    return running;
  }
  running = (async () => {
    const user = state.user;
    if (!user) return;
    update({ status: 'syncing' });
    try {
      const fb = await firebase();
      const remoteDoc = await fb.readDoc(user.uid);
      const remote: Side = { data: addPrefix(remoteDoc?.data), stamps: addPrefix(remoteDoc?.stamps) };
      // the first sync of this device: what is in the account wins over the settings found here
      const local = get(LAST_SYNC) ? localSide() : asNewDevice(localSide());
      const merged = mergeSides(local, remote);

      let localChanged = false;
      for (const [k, v] of Object.entries(merged.data)) {
        if (local.data[k] !== v) {
          set(k, v);
          localChanged = true;
        }
      }
      set(STAMPS, JSON.stringify({ ...readStamps(), ...merged.stamps }));

      const remoteChanged = !remoteDoc || Object.entries(merged.data).some(([k, v]) => remote.data[k] !== v);
      if (remoteChanged) await fb.writeDoc(user.uid, { data: strip(merged.data) as Record<string, string>, stamps: strip(merged.stamps) as Record<string, number>, updatedAt: Date.now() });

      const now = Date.now();
      set(LAST_SYNC, String(now));
      update({ status: 'synced', lastSync: now });
      if (localChanged && reloadOnChange) location.reload();
    } catch {
      update({ status: navigator.onLine ? 'error' : 'offline' });
    }
  })().finally(() => {
    running = null;
    if (again !== null) {
      const reload = again;
      again = null;
      void sync(reload);
    }
  });
  return running;
}
