/**
 * config.js — single place where environment values enter the app.
 *
 * Firebase web config values are public client identifiers, not secrets, but
 * they still live in a local `.env` file (gitignored) so the repo carries no
 * project-specific values at all. See `.env.example` and SETUP.md.
 *
 * When no config is present the app runs in clearly-labelled DEMO mode with a
 * local stand-in engine (see demoEngine.js) so the whole UI is explorable
 * without a Firebase project. The real Firebase AI Logic path is used
 * whenever a config is present.
 */

// Vite exposes `import.meta.env` at build time. In non-Vite contexts
// (unit tests) fall back to an empty object.
const env =
  typeof import.meta !== "undefined" && import.meta.env
    ? import.meta.env
    : {};

function readEnv(name) {
  const value = env[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
}

/** Firebase web-app config, or null when the app is unconfigured. */
export const firebaseConfig = (() => {
  const apiKey = readEnv("VITE_FIREBASE_API_KEY");
  const projectId = readEnv("VITE_FIREBASE_PROJECT_ID");
  const appId = readEnv("VITE_FIREBASE_APP_ID");
  if (!apiKey || !projectId || !appId) return null;
  return {
    apiKey,
    authDomain: readEnv("VITE_FIREBASE_AUTH_DOMAIN"),
    projectId,
    storageBucket: readEnv("VITE_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: readEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
    appId,
    measurementId: readEnv("VITE_FIREBASE_MEASUREMENT_ID") || undefined,
  };
})();

export const isConfigured = firebaseConfig !== null;

/** Cloud-hosted fallback model for Firebase AI Logic hybrid inference. */
export const cloudModel = readEnv("VITE_CLOUD_MODEL") || "gemini-3.8-flash";

/** reCAPTCHA v3 site key for App Check in production. Empty = debug provider. */
export const recaptchaSiteKey = readEnv("VITE_RECAPTCHA_SITE_KEY");

/** Localhost detection: App Check uses the debug provider on localhost. */
export const isLocalhost =
  typeof window !== "undefined" &&
  /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
