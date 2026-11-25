// Firebase (Auth + Firestore Lite). This module is heavy, so it is only loaded with import() when the user
// signs in or is already signed in (see cloud.ts). Config comes from VITE_FIREBASE_* env vars.

import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  connectAuthEmulator,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { connectFirestoreEmulator, doc, getFirestore, runTransaction } from 'firebase/firestore/lite';
import { firebaseConfig } from './cloudConfig';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

if (import.meta.env.VITE_USE_EMULATORS === '1') {
  // local test setup: npx firebase-tools emulators:start --only auth,firestore --project demo-chess
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

export type CloudUser = { uid: string; name: string; email: string; photo: string };

const toCloudUser = (u: User): CloudUser => ({ uid: u.uid, name: u.displayName ?? '', email: u.email ?? '', photo: u.photoURL ?? '' });

/** Calls back with the signed-in user (or null) now and on every change; also completes a redirect sign-in. */
export function watchUser(cb: (u: CloudUser | null) => void) {
  // first finish a redirect sign-in, so "no user" really means it did not happen (cancelled or failed)
  void getRedirectResult(auth)
    .catch(() => null) // no redirect in progress, or it failed — onAuthStateChanged still reports the state
    .then(() => onAuthStateChanged(auth, (u) => cb(u ? toCloudUser(u) : null)));
}

/** Popups are unreliable on phones and in an installed app; there the page redirects to Google and back. */
const preferRedirect = () =>
  window.matchMedia('(display-mode: standalone)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export async function signIn() {
  const testUser = import.meta.env.VITE_USE_EMULATORS === '1' && localStorage.getItem('emulator-google-user');
  if (testUser) {
    // emulator tests only: the Auth emulator accepts a fake Google ID token, no Google window needed
    await signInWithCredential(auth, GoogleAuthProvider.credential(testUser));
    return;
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  if (preferRedirect()) await signInWithRedirect(auth, provider);
  else await signInWithPopup(auth, provider);
}

export const signOut = () => fbSignOut(auth);

/** The user's synced data: { data: key -> JSON string, stamps: key -> last change time }. */
export type CloudDoc = { data: Record<string, string>; stamps: Record<string, number>; updatedAt: number };

const NOTHING_TO_WRITE = new Error('nothing to write');

/**
 * Reads the user's document and writes what `merge` makes of it (null: leave it as it is). If another device
 * writes in between, it starts over from that device's version, so neither overwrites the other.
 */
export async function mergeDoc(uid: string, merge: (remote: CloudDoc | null) => CloudDoc | null) {
  const ref = doc(db, 'users', uid);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const next = merge(snap.exists() ? (snap.data() as CloudDoc) : null);
      if (!next) throw NOTHING_TO_WRITE; // ends the transaction without a write
      tx.set(ref, next);
    });
  } catch (e) {
    if (e !== NOTHING_TO_WRITE) throw e;
  }
}
