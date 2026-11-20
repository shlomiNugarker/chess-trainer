# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Report them privately through GitHub:
**Security → Report a vulnerability** on https://github.com/shlomiNugarker/chess-trainer/security/advisories/new

Include what you found, how to reproduce it, and its impact. You'll get a reply as soon as possible, and credit in the fix if you want it.

## Scope

- The web app and its service worker (`src/`, `public/sw.js`).
- The optional sign-in and sync: Firestore security rules (`firestore.rules`) and how user data is stored.

The Firebase web configuration (API key, project id) is public by design; access to data is enforced by the Firestore rules. Reports showing that one user can read or write another user's data are especially welcome.

## Supported versions

Only the latest version on `main` (deployed at https://chess-trainer-seven-pink.vercel.app) is supported.
