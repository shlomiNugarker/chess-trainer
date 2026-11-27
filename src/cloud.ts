// Google sign-in and syncing progress between devices. Light module: Firebase itself (firebase.ts) is loaded
// only when the user signs in or is already signed in. Every save to localStorage is noticed in one place
// (a wrapper around setItem), stamped, and uploaded a few seconds later; the cloud copy is merged in on
// sign-in, on start and when the app comes back to the foreground.

import { useSyncExternalStore } from 'react';
import { cloudEnabled } from './cloudConfig';
import { ASIDE, PREFIX, asNewDevice, isSynced, mergeSides, type Side } from './syncMerge';
import type { CloudUser } from './firebase';

export type CloudStatus =
  | 'idle' | 'signing-in' | 'syncing' | 'synced' | 'offline' | 'error' | 'too-big' | 'no-room'
  | 'deleting' | 'delete-failed' | 'deleted' | 'deleted-elsewhere';
export type CloudState = { enabled: boolean; user: CloudUser | null; status: CloudStatus; lastSync: number | null };

const SIGNED_IN = PREFIX + 'cloud-signed-in';
const SIGNING_IN = PREFIX + 'cloud-signing-in';
const STAMPS = PREFIX + 'sync-stamps';
const LAST_SYNC = PREFIX + 'cloud-last-sync';
const OWNER = PREFIX + 'cloud-owner'; // the account (uid) this device's data belongs to
// the account (uid) whose cloud data is being deleted: nothing is uploaded for it any more (survives the trip to
// Google's page on phones, after which the deletion continues)
const DELETING = PREFIX + 'cloud-deleting';
const PUSH_DELAY = 3000;
/** Firestore refuses a document over 1 MiB; a little less, for its own overhead. */
const MAX_DOC_BYTES = 1_000_000;
const TOO_BIG = new Error('too much to sync');

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
/** The account changed: the page is loading again. */
let leaving = false;

function installHook() {
  Storage.prototype.setItem = function (key: string, value: string) {
    const watched = this === localStorage && isSynced(key);
    if (watched && leaving) return; // this page still shows the previous account's data
    const unchanged = watched && this.getItem(key) === value;
    nativeSet.call(this, key, value);
    // rewriting the same value is not a change: otherwise a device that is behind becomes "newer" and
    // overwrites the other device's change
    if (!watched || unchanged) return;
    const stamps = readStamps();
    // a change is newer than the one it replaces, also when this device's clock is behind the other device's
    stamps[key] = Math.max(Date.now(), (stamps[key] ?? 0) + 1);
    set(STAMPS, JSON.stringify(stamps));
    if (state.user && !deletingNow()) {
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
          if (get(DELETING) === user.uid) void finishDelete(user.uid, true); // back from Google's page: go on
          else void sync(true);
        } else {
          remove(SIGNED_IN);
          // no user and no sign-in window open: also the end of a redirect sign-in the user cancelled
          // (after a deletion the message about it stays)
          if (!signInOpen && !['deleting', 'deleted', 'deleted-elsewhere'].includes(state.status)) {
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

// ---- deleting the account's cloud data ----

/** Is the signed-in account's cloud data being deleted? Then nothing is uploaded. */
const deletingNow = () => !!state.user && get(DELETING) === state.user.uid;

/** After the account's cloud data is gone: this device is no longer anyone's, and its progress stays as it is. */
function forgetAccount() {
  clearTimeout(pushTimer);
  remove(DELETING);
  remove(SIGNED_IN);
  remove(OWNER);
  remove(LAST_SYNC);
  pageOwner = null;
}

/**
 * Deletes the signed-in account's cloud data: its document in Firestore and then the Firebase user. Progress on this
 * device stays. True when it is done; false if it failed (status 'delete-failed') or the page is going to Google's.
 */
export async function deleteCloudData(): Promise<boolean> {
  const user = state.user;
  if (!user) return false;
  set(DELETING, user.uid); // from now on no sync uploads anything
  clearTimeout(pushTimer);
  await running; // a sync already in progress does not write (stillHere), and nothing comes after it
  return finishDelete(user.uid, false);
}

async function finishDelete(uid: string, justSignedIn: boolean): Promise<boolean> {
  update({ status: 'deleting' });
  try {
    const fb = await firebase();
    if ((await fb.deleteAccount(uid, justSignedIn)) === 'redirect') return false;
  } catch {
    // DELETING stays: nothing is uploaded for this account until it is deleted (or another account signs in)
    if (state.user?.uid === uid) update({ status: 'delete-failed' });
    return false;
  }
  forgetAccount();
  update({ user: null, status: 'deleted', lastSync: null });
  return true;
}

// ---- one account at a time ----

/** The account whose data this page has read from localStorage (null: nobody has signed in here yet). */
let pageOwner: string | null = null;

/**
 * Another account signed in: the previous one's data is kept aside on this device, and the new one's (if it was
 * here before) comes back; they are never merged. Language and sound stay, they belong to the device.
 * Returns false, changing nothing, if there is no room to keep the data aside.
 */
function switchOwner(from: string, to: string): boolean {
  const aside = JSON.stringify({ ...localSide(), lastSync: get(LAST_SYNC) });
  set(ASIDE + from, aside);
  if (get(ASIDE + from) !== aside) return false;
  for (const k of Object.keys(localSide().data)) if (k !== PREFIX + 'lang' && k !== PREFIX + 'sound') remove(k);
  remove(STAMPS);
  remove(LAST_SYNC);
  try {
    const back = JSON.parse(get(ASIDE + to) ?? 'null') as (Side & { lastSync: string | null }) | null;
    remove(ASIDE + to); // first, so there is room for the data itself
    if (back) {
      for (const [k, v] of Object.entries(back.data)) set(k, v);
      set(STAMPS, JSON.stringify(back.stamps));
      if (back.lastSync && Object.entries(back.data).every(([k, v]) => get(k) === v)) set(LAST_SYNC, back.lastSync);
    }
  } catch {
    /* broken copy: the account's data comes from the cloud */
  }
  set(OWNER, to);
  return true;
}

/** Makes sure the data on this device is the signed-in user's. False: it is not (yet), so do not sync. */
function ownData(uid: string): boolean {
  if (leaving) return false;
  const owner = pageOwner ?? get(OWNER);
  if (owner && owner !== uid) {
    if (get(OWNER) !== uid && !switchOwner(owner, uid)) {
      update({ status: 'no-room' });
      return false;
    }
    // every screen still shows the other account's data
    leaving = true;
    location.reload();
    return false;
  }
  pageOwner = uid;
  if (get(OWNER) !== uid) set(OWNER, uid); // the first sign-in here: what is on the device joins the account
  return true;
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
    if (!user || deletingNow() || !ownData(user.uid)) return;
    const stillHere = () => state.user?.uid === user.uid && !leaving && !deletingNow();
    /** This device synced this account before, and now its document is gone: deleted on another device. */
    let goneElsewhere = false;
    update({ status: 'syncing' });
    try {
      const fb = await firebase();
      let local: Side = { data: {}, stamps: {} };
      let merged = local;
      // may run more than once, when another device writes at the same moment
      await fb.mergeDoc(user.uid, (remoteDoc) => {
        if (!stillHere()) return null;
        // never bring deleted data back: a device that synced before finds no document only after a deletion
        if (!remoteDoc && get(LAST_SYNC)) {
          goneElsewhere = true;
          return null;
        }
        const remote: Side = { data: addPrefix(remoteDoc?.data), stamps: addPrefix(remoteDoc?.stamps) };
        // the first sync of this device: what is in the account wins over the settings found here
        local = get(LAST_SYNC) ? localSide() : asNewDevice(localSide());
        merged = mergeSides(local, remote);
        const remoteChanged = !remoteDoc || Object.entries(merged.data).some(([k, v]) => remote.data[k] !== v);
        if (!remoteChanged) return null;
        const next = { data: strip(merged.data) as Record<string, string>, stamps: strip(merged.stamps) as Record<string, number>, updatedAt: Date.now() };
        if (new TextEncoder().encode(JSON.stringify(next)).length > MAX_DOC_BYTES) throw TOO_BIG;
        return next;
      });
      if (!stillHere()) return; // signed out (or another account) meanwhile: this device's data is not touched
      if (goneElsewhere) {
        // the account's cloud data was deleted: this device signs out of it and keeps its progress
        forgetAccount();
        await fb.signOut().catch(() => {});
        update({ user: null, status: 'deleted-elsewhere', lastSync: null });
        return;
      }

      let localChanged = false;
      const stamps = readStamps();
      for (const [k, v] of Object.entries(merged.data)) {
        const here = get(k) ?? undefined;
        if (here !== local.data[k]) continue; // changed here during the sync: kept, and the next sync merges it
        stamps[k] = merged.stamps[k];
        if (here === v) continue;
        set(k, v);
        localChanged = true;
      }
      set(STAMPS, JSON.stringify(stamps));

      const now = Date.now();
      set(LAST_SYNC, String(now));
      update({ status: 'synced', lastSync: now });
      if (localChanged && reloadOnChange) location.reload();
    } catch (e) {
      if (stillHere()) update({ status: e === TOO_BIG ? 'too-big' : navigator.onLine ? 'error' : 'offline' });
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
