# CropSentry 🌿

**Offline-first crop health scouting, powered by Firebase AI Logic hybrid inference.**

CropSentry is a web app for agricultural field scouts and extension workers. Photograph a plant, and Gemini Nano — running **on the device** in Chrome through Firebase AI Logic — reads the leaf privately, offline, and free. When a case is severe or uncertain, the scout escalates to cloud Gemini for the full agronomist report. Every answer is labelled with the engine that produced it, so the hybrid is visible, honest, and meaningful — not a gimmick.

Built for the **#BuildHybridAI 2026** hackathon (Best Web/Chrome track).

## Why hybrid, why this problem

Field scouts work where connectivity is patchy and data is expensive. Sending every leaf photo to the cloud is slow, costly, and leaks farmers' field data. But a small on-device model can't write a full agronomist report either. CropSentry splits the work the way the problem demands:

1. **Routine checks stay on-device.** Photo + notes go to Gemini Nano inside Chrome via Firebase AI Logic's hybrid inference (`PREFER_ON_DEVICE`). Nothing is uploaded, nothing is billed, and it works with no connection at all.
2. **The fallback is automatic.** On browsers without an on-device model, the identical request runs against cloud Gemini — same prompt, same structured JSON result, labelled as cloud.
3. **Depth is a deliberate escalation.** Severe or uncertain cases get a full agronomist report (diagnosis, differential diagnoses, treatment plan, prevention, safety notes, urgency) from the cloud model — only when the scout asks for it.

## How Firebase AI Logic is used

- **Hybrid inference (the core):** `getGenerativeModel(ai, { mode, inCloudParams })` from `firebase/ai`, with all four `InferenceMode`s user-selectable (Prefer on-device / On-device only / Prefer cloud / Cloud only). The on-device model is initialized with `initializeDeviceModel()` from a user gesture, with download progress shown.
- **Structured output:** both tasks use `generationConfig` with `responseMimeType: "application/json"` and a JSON schema, so on-device and cloud return the identical shape — one contract, two engines. Responses are validated and repaired defensively (`src/schemas.js`).
- **Route transparency:** every result reads `response.inferenceSource` (`on_device` / `in_cloud`) plus latency and `usageMetadata`, and displays it on the result card and in the stats panel.
- **Multimodal input:** JPEG/PNG photos go to the model as inline data. Other formats are re-encoded to JPEG via canvas so the on-device path still works.
- **App Check:** enforced for AI Logic (required). Debug provider on localhost, reCAPTCHA v3 in production.
- **Anonymous Auth + Firestore:** scouts get a stable anonymous uid; the field log mirrors to Firestore when connected, and always works locally (offline-first).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

**Without a Firebase config**, the app runs in clearly-labelled **demo mode** with a built-in sample engine, so the full UI and flow are explorable with no setup. **With a config** (see below), every AI call goes through real Firebase AI Logic.

```bash
npm test           # unit tests (schema validation + JSON repair)
npm run build      # production build into dist/
npm run preview    # serve the production build locally
```

## Connect Firebase (real AI)

Copy `.env.example` to `.env` and fill in your Firebase web app config. Full step-by-step instructions — project creation, AI Logic setup, App Check debug token, Firestore rules, hosting — are in **[SETUP.md](SETUP.md)**.

On-device inference additionally needs **desktop Chrome 139+** with the flag `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` set to Enabled, and the Gemini Nano model downloaded (the app's "Prepare on-device model" button does this on first use).

## Project layout

```
index.html            App shell
src/
  main.js             UI wiring, demo flow, field-log rendering
  ai.js               Hybrid engine (Firebase AI Logic, all 4 modes)
  schemas.js          Structured-output contracts + validation (pure, tested)
  firebase.js         App / App Check / anonymous Auth / Firestore bootstrap
  config.js           Environment config (no secrets in the repo)
  store.js            Field log: local-first, Firestore mirror
  demoEngine.js       Labelled stand-in engine for unconfigured runs
  styles.css          All styling, no external assets
tests/                Unit tests (node:test)
SETUP.md              Exact Firebase project setup steps
BUILD-REPORT.md       Architecture, testing evidence, demo script
```

## Value proposition

Smallholder farmers lose 20–40% of yields to pests and disease, and the expert advice that could prevent it rarely reaches the field in time — or at all, where connectivity is poor. CropSentry puts a first-pass plant doctor in the scout's browser that works offline, costs nothing per check, keeps farmers' field data on the device, and knows when to call in the cloud for the hard cases. One scout with a laptop can triage a whole cooperative's fields in a day, and every observation is logged for follow-up.

## License

MIT — see [LICENSE](LICENSE). Original work by Oguinye Nelson Ifeanyichukwu, created for #BuildHybridAI 2026. AI assessments support, and do not replace, professional agronomic advice.
