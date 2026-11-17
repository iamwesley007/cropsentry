/**
 * firebase.js — Firebase bootstrap: app, App Check, anonymous Auth, Firestore.
 *
 * Everything here is lazy and defensive: when the app is unconfigured
 * (no .env values), every export resolves to null and the app runs in
 * clearly-labelled demo mode. No Firebase call is ever made unconfigured.
 */
import { initializeApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  getToken as getAppCheckToken,
} from "firebase/app-check";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import {
  firebaseConfig,
  isConfigured,
  isLocalhost,
  recaptchaSiteKey,
} from "./config.js";

let app = null;
let appCheck = null;
let auth = null;
let db = null;
let initPromise = null;

/**
 * Initialize Firebase exactly once. Returns the handles (or nulls when
 * unconfigured). Safe to call repeatedly.
 */
export function initFirebase() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!isConfigured) return { app: null, appCheck: null, auth: null, db: null };

    app = initializeApp(firebaseConfig);

    // App Check is enforced for AI Logic. On localhost we use the debug
    // provider (docs: set FIREBASE_APPCHECK_DEBUG_TOKEN before init; the
    // console then prints a token to safelist in Firebase console).
    // In production we use reCAPTCHA v3 when a site key is configured.
    if (isLocalhost || !recaptchaSiteKey) {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      appCheck = initializeAppCheck(app, { isTokenAutoRefreshEnabled: true });
    } else {
      appCheck = initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(recaptchaSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    }

    auth = getAuth(app);
    db = getFirestore(app);

    // Anonymous sign-in gives every scout a stable uid for their field log
    // without any account creation or personal data.
    try {
      await signInAnonymously(auth);
    } catch (error) {
      // Auth failing must not kill the app: the field log still works
      // locally, and AI inference only needs App Check.
      console.warn("[CropSentry] Anonymous sign-in failed:", error);
    }
    return { app, appCheck, auth, db };
  })();
  return initPromise;
}

export function getDb() {
  return db;
}

export function getAuthInstance() {
  return auth;
}

/** Resolves with the current uid, or null when signed out / unconfigured. */
export function currentUid() {
  return new Promise((resolve) => {
    if (!auth) return resolve(null);
    if (auth.currentUser) return resolve(auth.currentUser.uid);
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user ? user.uid : null);
    });
  });
}

/**
 * Force an App Check token refresh. Called before the first AI request so
 * the debug token (localhost) is minted early and any App Check problem
 * surfaces as a clear error instead of a failed inference call.
 */
export async function warmAppCheck() {
  if (!appCheck) return false;
  try {
    await getAppCheckToken(appCheck, false);
    return true;
  } catch (error) {
    console.warn("[CropSentry] App Check token failed:", error);
    return false;
  }
}
