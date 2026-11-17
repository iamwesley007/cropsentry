# CropSentry setup — Firebase project, step by step

Follow these steps once, in order. No step requires a credit card: the Gemini Developer API backend and the Firebase free tier cover this app.

## 1. Create the Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/) and click **Add project** (or **Create a project**).
2. Name it (e.g. `cropsentry`), accept the terms, and create it. When asked, you do **not** need Google Analytics for this app.
3. Wait for provisioning, then open the project.

## 2. Enable Firebase AI Logic (Gemini Developer API)

1. In the console, go to **AI Services → AI Logic**.
2. Click **Get started** and follow the guided workflow. It sets up the required APIs and resources.
3. When asked to choose a **Gemini API provider**, choose **Gemini Developer API** (free tier, no billing).
4. The workflow automatically **enforces Firebase App Check for AI Logic**. That is expected — step 5 covers it.

## 3. Register the web app and get the config

1. In **Project settings** (gear icon) → **Your apps**, click the **Web** (`</>`) icon.
2. Give the app a nickname (e.g. `cropsentry-web`). Do **not** check "Also set up Firebase Hosting" here unless you want hosting now (step 7 covers hosting separately).
3. Click **Register app**. Copy the `firebaseConfig` object shown.
4. In the repo, copy `.env.example` to `.env` and paste the values into the matching `VITE_FIREBASE_*` variables:
   - `apiKey` → `VITE_FIREBASE_API_KEY`
   - `authDomain` → `VITE_FIREBASE_AUTH_DOMAIN`
   - `projectId` → `VITE_FIREBASE_PROJECT_ID`
   - `storageBucket` → `VITE_FIREBASE_STORAGE_BUCKET`
   - `messagingSenderId` → `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `appId` → `VITE_FIREBASE_APP_ID`
   - `measurementId` → `VITE_FIREBASE_MEASUREMENT_ID` (may be absent — leave empty)
5. Never commit `.env` — it is gitignored. `.env.example` holds placeholders only.

## 4. Enable Anonymous Auth + Firestore (field log sync)

1. **Authentication → Sign-in method → Anonymous → Enable → Save.**
2. **Firestore Database → Create database.** Choose **Production mode** and a nearby location, then create.
3. In **Firestore → Rules**, replace the rules with the following (each scout reads/writes only their own observations):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /scouts/{uid}/observations/{docId} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

4. Click **Publish**. (Without these rules, Firestore mirroring fails and the log stays local-only — the app still works.)

## 5. App Check — debug token for localhost, reCAPTCHA for production

Firebase AI Logic requires App Check. The app handles both cases automatically:

**Localhost development (debug provider):**

1. Run `npm run dev` and open the app.
2. Open DevTools → Console. On first load you will see a line like:
   `AppCheck debug token: "123a4567-b89c-12d3-e456-789012345678". You will need to safelist it in the Firebase console for it to work.`
3. In the console, go to **Security → App Check → Apps** tab, find your web app, open the overflow menu (⋮) → **Manage debug tokens** → **Add debug token**, paste the token, save.
4. Reload the app. Inference calls now pass App Check.

**Production (hosted) builds:**

1. Register a reCAPTCHA v3 site key for your hosting domain at the [reCAPTCHA admin console](https://www.google.com/recaptcha/admin) (type: **v3**).
2. In Firebase console → **Security → App Check → Apps**, select your app, and register the reCAPTCHA v3 provider with that site key.
3. Put the site key in `.env` as `VITE_RECAPTCHA_SITE_KEY` and rebuild. The app uses reCAPTCHA automatically whenever a site key is set and the host is not localhost.

## 6. Enable the on-device model (Chrome)

On-device inference needs **desktop Chrome 139+**:

1. Open `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and set it to **Enabled**.
2. Restart Chrome.
3. In CropSentry, click **Prepare on-device model**. The first run downloads Gemini Nano into Chrome (a few hundred MB, one time). Progress is shown; afterwards the model stays on the device.
4. You can verify availability in DevTools console with `await LanguageModel.availability()` — it should return `"available"`.

Note: on-device inference is desktop-Chrome-only. In any other browser the app automatically uses the cloud fallback — that is the hybrid design working as intended.

## 7. Host the demo (optional, recommended for judging)

Firebase Hosting is the simplest path:

```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # public directory: dist ; single-page app: yes ; do NOT overwrite dist/index.html
npm run build
firebase deploy --only hosting
```

Any static host works too (`dist/` is plain static files). Remember step 5's production App Check setup for the hosted domain.

## 8. Verify the real thing end to end

1. `npm run dev`, open the app in desktop Chrome 139+ (flag enabled).
2. Confirm the top bar says **"Config: Firebase connected"** and there is **no** demo-mode banner.
3. Click **Prepare on-device model** → wait for "ready".
4. Add a real crop photo, pick the crop, click **Analyze on-device**.
5. The result card should say **"Analyzed on-device"** with latency and "0 cloud tokens".
6. Click **Get the full agronomist report** → the report card should say **"Analyzed in the cloud"** with a token count.
7. Reload: the field log entry persists, and (if Firestore rules are set) shows **Synced**.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Blocked by App Check" / 403 on AI calls | Safelist the localhost debug token (step 5) or check the reCAPTCHA key on the hosted domain. |
| On-device model "unavailable" | Check Chrome version (139+), the Prompt API flag, and free disk space (the model download needs room). The cloud fallback still works. |
| "Quota exhausted" | The Gemini Developer API free tier reset. On-device analysis is unaffected. |
| Field log not syncing | Check Anonymous Auth is enabled and the Firestore rules in step 4 are published. Local log always works regardless. |
| Demo-mode banner still showing | `.env` is missing or incomplete — all of `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, and `VITE_FIREBASE_APP_ID` are required. Restart the dev server after editing `.env`. |
