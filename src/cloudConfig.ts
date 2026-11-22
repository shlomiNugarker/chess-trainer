// Firebase web config. These values are public by design (security is in firestore.rules);
// they come from env vars so the code works before the Firebase project exists:
// without them the sign-in button is simply not shown. See docs/google-login-setup.md.

const env = import.meta.env;

// On Vercel the app has more than one address (chess-trainer-seven-pink.vercel.app, opening-trainer-app.vercel.app),
// and each one proxies /__/auth/ to Firebase (vercel.json). Sign-in must run on the address the page was opened
// from: a redirect sign-in through another domain fails in browsers that block third-party storage (Safari/iOS).
// Each address must also be authorized in Firebase Auth, the API key and the OAuth client (docs/google-login-setup.md).
const vercelHost = typeof location !== 'undefined' && location.hostname.endsWith('.vercel.app') ? location.host : undefined;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  // the app's own domain (proxied to Firebase by vercel.json) so redirect sign-in works in Safari/iOS too
  authDomain: vercelHost || (env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) || `${env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

/** Sign-in is offered only when the Firebase project is configured. */
export const cloudEnabled = !!(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
