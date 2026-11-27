// Firebase (Auth + Firestore Lite). This module is heavy, so it is only loaded with import() when the user
// signs in or is already signed in (see cloud.ts). Config comes from VITE_FIREBASE_* env vars.

import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  connectAuthEmulator,
  deleteUser,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  reauthenticateWithRedirect,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { connectFirestoreEmulator, deleteDoc, doc, getFirestore, runTransaction } from 'firebase/firestore/lite';
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

/** Emulator tests only: a fake Google ID token the Auth emulator accepts (no Google window). */
const emulatorUser = () => import.meta.env.VITE_USE_EMULATORS === '1' && localStorage.getItem('emulator-google-user');

export async function signIn() {
  const testUser = emulatorUser();
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

/** Signs in again with the same Google window as signIn(). 'redirect': the page goes to Google and comes back. */
async function signInAgain(user: User): Promise<'done' | 'redirect'> {
  const testUser = emulatorUser();
  const provider = new GoogleAuthProvider();
  if (testUser) await reauthenticateWithCredential(user, GoogleAuthProvider.credential(testUser));
  else if (preferRedirect()) {
    await reauthenticateWithRedirect(user, provider);
    return 'redirect';
  } else await reauthenticateWithPopup(user, provider);
  return 'done';
}

/** Firebase deletes a user only shortly after they signed in. */
const RECENT_SIGN_IN = 4 * 60_000;

/**
 * Deletes the user's synced document (users/{uid}) and then the Firebase user. An old sign-in is renewed first,
 * before anything is deleted (cancelling the Google window leaves everything as it was); if Firebase still asks for a
 * recent sign-in, it is renewed once more. 'redirect': on a phone the page goes to Google and back, and cloud.ts
 * continues the deletion after the reload (with `justSignedIn`).
 */
export async function deleteAccount(uid: string, justSignedIn: boolean): Promise<'deleted' | 'redirect'> {
  const user = auth.currentUser;
  if (!user || user.uid !== uid) throw new Error('not signed in as this user');
  const last = Date.parse(user.metadata.lastSignInTime ?? '') || 0;
  if (!justSignedIn && Date.now() - last > RECENT_SIGN_IN && (await signInAgain(user)) === 'redirect') return 'redirect';
  await deleteDoc(doc(db, 'users', uid));
  try {
    await deleteUser(user);
  } catch (e) {
    if ((e as { code?: string }).code !== 'auth/requires-recent-login') throw e;
    if ((await signInAgain(user)) === 'redirect') return 'redirect';
    await deleteUser(user);
  }
  return 'deleted';
}

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
