# Google sign-in setup (Firebase) — browser steps

Goal: turn on "Sign in with Google" in the Chess Trainer app (https://opening-trainer-app.vercel.app), so a player's progress syncs between devices. The code is already in the app. It stays hidden until a Firebase project exists and its config is added. For a deployment of your own, use its address wherever this one appears.

These steps are done in the browser, signed in to the owner's Google account. They take about 15 minutes. Do them in order; each step ends with a **Check** you can verify on screen.

**Do not:**
- Enable billing or upgrade the plan. Everything here runs on the free **Spark** plan.
- Make the database rules open (`allow read, write: if true`).
- Create API keys or service accounts. None are needed.

At the end, report back the 3 values listed in step 8.

---

## 1. Create the Firebase project

1. Open https://console.firebase.google.com and click **Create a project** (or **Add project**).
2. Project name: `chess-trainer`. Accept the terms and click **Continue**. Firebase may add a suffix to the project ID (e.g. `chess-trainer-1a2b3`). That's fine; note the final **Project ID**.
3. If asked about **Gemini in Firebase**, you can leave it off. When asked about **Google Analytics**, turn it **off**. Then click **Create project** and wait. Click **Continue** when it's ready.

**Check:** the project overview page opens with the project name at the top.

## 2. Register the web app and copy its config

1. On the project overview, click the **Web** icon (`</>`), labelled "Add app" → Web.
2. App nickname: `chess-trainer-web`. Leave **"Also set up Firebase Hosting" unchecked**. Click **Register app**.
3. A code block with `const firebaseConfig = { ... }` appears. Copy these values (you'll report them in step 8):
   - `apiKey`
   - `projectId`
   - `appId`
4. Click **Continue to console**. Skip the npm/SDK instructions; the app already has the SDK.

**Check:** Project settings (gear icon → Project settings → General → Your apps) lists a web app `chess-trainer-web`.

## 3. Turn on Google sign-in

1. Left menu: **Build → Authentication** → **Get started**.
2. Tab **Sign-in method** → **Add new provider** (or the provider list) → **Google**.
3. Switch **Enable** on. Set **Project support email** to the owner's email. Click **Save**.

**Check:** in Sign-in method, Google shows status **Enabled**.

## 4. Allow the app's domain

1. Still in **Authentication**, open the **Settings** tab → **Authorized domains**.
2. Click **Add domain** and enter `opening-trainer-app.vercel.app` (no `https://`, no slash), then **Add**.

**Check:** the list contains `localhost`, `<projectId>.firebaseapp.com`, and `opening-trainer-app.vercel.app`.

## 5. Create the database and its security rules

1. Left menu: **Build → Firestore Database** → **Create database**.
2. Edition: **Standard** (if asked). Location: `eur3 (europe-west)` or any European location. The location can't be changed later, but any choice works.
3. Mode: **Start in production mode**. Click **Create** and wait for it to finish.
4. Open the **Rules** tab, replace everything in the editor with the text below, and click **Publish**:

```
rules_version = '2';

// Each signed-in user can read and write only their own document: users/{their uid}.
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, delete: if request.auth != null && request.auth.uid == uid;
      allow create, update: if request.auth != null && request.auth.uid == uid
        && request.resource.data.keys().hasOnly(['data', 'stamps', 'updatedAt'])
        && request.resource.data.data is map
        && request.resource.data.stamps is map;
    }
    // everything else is closed
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

**Check:** the Rules tab shows this text, with a "Last published" time of just now. The **Data** tab is empty, which is expected.

## 6. Google Cloud: allow the app's sign-in page

Firebase created a Google OAuth client automatically. It needs to know the app's address, because the app runs the sign-in on its own domain.

1. Open https://console.cloud.google.com/apis/credentials and make sure the project selector at the top shows the same project (`chess-trainer…`, same Project ID as step 1).
2. Under **OAuth 2.0 Client IDs**, click **Web client (auto created by Google Service)**.
3. **Authorized JavaScript origins** → **Add URI** → `https://opening-trainer-app.vercel.app`
4. **Authorized redirect URIs** → **Add URI** → `https://opening-trainer-app.vercel.app/__/auth/handler`
   Keep the URI that's already there (`https://<projectId>.firebaseapp.com/__/auth/handler`).
5. Click **Save**.
6. Optional, but nicer: left menu **Google Auth Platform → Branding** (older consoles: **OAuth consent screen**). Set **App name** to `Chess Trainer`, user support email to the owner's email, and **Save**. This is the name shown in the Google sign-in window.
7. In **Google Auth Platform → Audience**: if **Publishing status** is **Testing**, click **Publish app** → **Confirm**. With only the basic profile/email scopes, Google needs no review. In Testing mode only listed test users could sign in.

**Check:** the client shows both new URIs saved, and Audience shows **In production**.

## 7. (Done by Claude Code) Vercel

Nothing to do in the browser. Claude Code adds the config to Vercel with the CLI and redeploys.

## 8. Report back

Send these values back in the chat. They're public identifiers, not secrets:

```
VITE_FIREBASE_API_KEY=<apiKey from step 2>
VITE_FIREBASE_PROJECT_ID=<projectId from step 2>
VITE_FIREBASE_APP_ID=<appId from step 2>
```

Also mention whether any step showed an error or looked different from these instructions.

---

### Afterwards: what Claude Code does and how to verify
- Puts the values in `.env.local` and in Vercel (Production, Preview, Development).
- Adds `vercel.json`, which proxies `/__/auth/*` to `https://<projectId>.firebaseapp.com/__/auth/*` (Google sign-in on the app's own domain), and redeploys.
- **The owner then verifies:** open the site → **Account** (👤) → **Sign in with Google** → choose an account. The panel shows the name and "Synced ✓". In Firebase → Firestore → Data, a document appears under `users`.

---

## Adding another address for the app

The app is served at `opening-trainer-app.vercel.app` and, as before, at `chess-trainer-seven-pink.vercel.app` (both are domains of the same Vercel project). On any `*.vercel.app` address, sign-in runs on the address the page was opened from (`src/cloudConfig.ts`), so a new address must be allowed in three places, next to the existing ones:

1. **Firebase → Authentication → Settings → Authorized domains:** add the host, e.g. `opening-trainer-app.vercel.app`.
2. **Google Cloud → APIs & Services → Credentials → Browser key (auto created by Firebase) → Website restrictions:** add `https://<host>/*`. Without it every Firebase call from the new address fails with "Requests from referer … are blocked".
3. **Google Cloud → Credentials → Web client (auto created by Google Service):** add `https://<host>` to Authorized JavaScript origins and `https://<host>/__/auth/handler` to Authorized redirect URIs.

Check: from the new address, Account → Sign in with Google opens the Google window with no error. Progress is saved per address in the browser, so on a new address sign in once to load it from the cloud.
