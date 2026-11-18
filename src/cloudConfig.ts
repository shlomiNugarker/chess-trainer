// Firebase web config. These values are public by design (security is in firestore.rules);
// they come from env vars so the code works before the Firebase project exists:
// without them the sign-in button is simply not shown. See docs/google-login-setup.md.

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  // the app's own domain (proxied to Firebase by vercel.json) so redirect sign-in works in Safari/iOS too
  authDomain: (env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) || `${env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

/** Sign-in is offered only when the Firebase project is configured. */
export const cloudEnabled = !!(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
