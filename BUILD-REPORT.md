# CropSentry — build report

**Entrant:** Oguinye Nelson Ifeanyichukwu (individual entry)
**Contest:** #BuildHybridAI 2026, Best Web/Chrome track
**Built:** 17–18 Nov 2026, during the submission period (Nov 11–30, 2026)
**Stack:** Vite + vanilla JS modules, Firebase JS SDK v13.4.0 (`firebase/ai`, `firebase/app-check`, `firebase/auth`, `firebase/firestore`). No framework, no external assets, no build-time secrets.

## Concept

**CropSentry** — offline-first crop health scouting for agricultural field workers.

The hybrid split follows the problem, not the demo: routine leaf checks run on-device (Gemini Nano in Chrome via Firebase AI Logic), because scouts work where connectivity is patchy and field photos shouldn't have to leave the device; the deep agronomist report runs in the cloud, because it needs the bigger model — and only when the scout explicitly escalates. Every answer is labelled with the engine that produced it, with latency and token counts, so judges and users can see the hybrid working rather than take it on faith.

Why it can win:
- **Technological implementation:** real hybrid inference — all four `InferenceMode`s, `initializeDeviceModel()` with download progress, structured JSON output on both paths under one schema, `inferenceSource` surfacing, multimodal image input with automatic JPEG re-encoding for on-device compatibility, App Check enforced, Firestore + anonymous Auth for the synced field log.
- **Design:** a complete product (scout flow, engine panel, field log, stats, offline-first storage), not a prompt demo.
- **Potential impact:** a specific, real audience (extension workers / smallholder cooperatives) with a specific, real constraint (connectivity + cost + privacy) that hybrid inference uniquely solves.
- **Quality of idea:** the on-device model isn't a gimmick here — privacy, offline use, and zero marginal cost are the product's core value, and the cloud escalation is a deliberate, visible decision.

## Architecture

```
index.html            App shell (semantic, accessible)
src/
  main.js             UI wiring + demo flow + log rendering + sample photo
  ai.js               HybridEngine: model factory, device init, analyze,
                      deepReport, image conversion, error explanations
  schemas.js          ANALYSIS_SCHEMA / REPORT_SCHEMA, extractJson,
                      validateAnalysis / validateReport (pure, tested)
  firebase.js         initApp, App Check (debug/reCAPTCHA), anon Auth, Firestore
  config.js           .env -> config; isConfigured gate; model names
  store.js            FieldLog (localStorage-first, Firestore mirror) + stats
  demoEngine.js       Labelled stand-in engine, ONLY when unconfigured
  styles.css          Full styling, system fonts, no external assets
tests/schemas.test.js Unit tests for the pure schema logic
```

**Data flow (field analysis):** photo File → `fileToPart` (JPEG/PNG direct, else canvas re-encode + downscale to 1024px) → `HybridEngine.analyze` → `generateContent([prompt, imagePart])` on the hybrid model → `response.text()` → `extractJson` → `validateAnalysis` → result card + stats + field log entry.

**Data flow (report):** stored photo data URL → part → `deepReport` on the `ONLY_IN_CLOUD` model → same parse/validate path → report card appended to the entry.

**One contract, two engines:** `ANALYSIS_SCHEMA` / `REPORT_SCHEMA` are passed as `responseSchema` to the model AND used to validate whatever text returns, so on-device and cloud outputs are interchangeable everywhere downstream.

## What was verified (API surface)

Verified against the official docs AND the installed SDK typings/source (firebase 13.4.0), not from memory:

- `firebase/ai` exports `getAI`, `getGenerativeModel`, `GoogleAIBackend`, `InferenceMode`, `InferenceSource` — confirmed in `ai-public.d.ts`.
- `getGenerativeModel(ai, { mode, inCloudParams: { model, generationConfig, systemInstruction } })` — `HybridParams` confirmed; `inCloudParams` is `ModelParams`.
- `model.initializeDeviceModel(onDownloadProgress)` — confirmed; must follow a user gesture (enforced: called from button clicks).
- `result.response.inferenceSource` (`"on_device"` / `"in_cloud"`) — confirmed in typings and in the SDK's routing code (`callCloudOrDevice`).
- `generationConfig: { responseMimeType: "application/json", responseSchema }` — confirmed; the same params flow to both the on-device and cloud calls in the SDK source.
- Image parts: `{ type: "inlineData", inlineData: { data, mimeType } }` — confirmed in docs and typings.
- Cloud model default `gemini-3.8-flash` — confirmed current (Sept 2026 release; Gemini 2.5 models deprecated/limited as of Sept–Oct 2026). Overridable via `VITE_CLOUD_MODEL`.
- On-device requirements: Firebase AI Logic SDK v12.5.0+ (we ship 13.4.0), desktop Chrome 139+, flag `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`. Single-turn text generation only (no chat/tools) — the app's design respects this.

## Testing performed

**Unit tests** — `npm test`: 10/10 pass. Covers schema declarations, JSON extraction (bare / fenced / prose-wrapped / garbage), analysis + report validation and repair (bad category, out-of-range severity, bad urgency, unparseable input).

**Production build** — `npm run build`: succeeds (Vite). One chunk-size warning (641 kB JS, Firebase SDK) — acceptable for a demo; no action needed.

**End-to-end browser tests** — headless Chromium (Playwright), production build, demo mode: **29/29 checks pass, zero console errors, zero page errors.** Covered: boot + demo banner, photo sample flow, mode switching, device preparation, full analysis flow (badge, severity, symptoms, action, confidence), cloud report flow, field-log creation + persistence across reload + re-opening entries, stats persistence, photo clearing.

**Prompt API probe** — in the sandbox's headless Chromium, `LanguageModel` exists and `availability()` returns `"unavailable"` (no model download possible headlessly). The availability-detection code path works; the live model itself could not be exercised here (see below).

## What could NOT be verified without a live Firebase project / real Chrome

Honest gaps — all require the setup in SETUP.md, on a real machine:

1. **Live on-device inference** (Gemini Nano via the Prompt API): needs desktop Chrome 139+ with the flag on, a model download (hundreds of MB), and a GPU/16 GB RAM machine. The sandbox's headless Chromium reports the model unavailable. The code path is verified against docs + SDK source, and the UI handles all availability states, but no real on-device call was made.
2. **Live cloud inference** (Gemini Developer API via Firebase AI Logic): needs a Firebase project + App Check. No project exists yet (account creation is the parent's step). The model construction, schema wiring, and response handling are verified statically; no live cloud call was made.
3. **App Check end-to-end** (debug token safelisting / reCAPTCHA): needs the Firebase console. Code follows the documented pattern exactly.
4. **Firestore sync + anonymous Auth**: needs the project + rules. Code paths are defensive (failures leave the local log working); sync itself untested live.
5. **Real-photo accuracy**: the sample analyses in demo mode are fixed samples. Real accuracy depends on the live models and real photos — untested.

## Still needed before submission (parent's steps)

1. **Firebase project** per SETUP.md (project, AI Logic with Gemini Developer API, web app config → `.env`, Anonymous Auth, Firestore + rules, App Check debug token / reCAPTCHA).
2. **Live verification run** per SETUP.md step 8 on desktop Chrome: confirm "Analyzed on-device" + "Analyzed in the cloud" badges with a real photo.
3. **Public GitHub repo** (this code, MIT licensed) — no secrets in the repo; `.env` is gitignored.
4. **Hosted demo** (Firebase Hosting recommended) + production App Check key.
5. **Demo video ≤ 3 min on YouTube** (script below) + Devpost submission text (README's "How Firebase AI Logic is used" + value proposition sections are written to be lifted directly).

## Demo script outline (≤ 3 minutes)

- **0:00–0:20 — The problem.** "Scouts work where the signal doesn't. Every leaf photo sent to the cloud costs time, money, and farmers' privacy." Show the app, point at the Hybrid engine panel.
- **0:20–0:50 — On-device analysis.** Upload a real crop photo, pick the crop, click Analyze. Show the download/prepare step briefly, then the result card: "Analyzed on-device · 0 cloud tokens · private." Walk the severity, symptoms, immediate action.
- **0:50–1:20 — The hybrid switch.** Change the mode to "Cloud only", re-run: same shape, "Analyzed in the cloud" badge + token count. Switch back. Point at the stats: on-device vs cloud counts.
- **1:20–2:10 — The escalation.** Click "Get the full agronomist report." Show diagnosis, treatment plan, prevention, safety notes, urgency. "Depth on demand — the scout decides, and the label shows it."
- **2:10–2:40 — The field log.** Show the log entry, reload persistence, synced badge. "Works offline, syncs when connected."
- **2:40–3:00 — Close.** "CropSentry: routine checks stay on the device, depth is one tap away. Built with Firebase AI Logic hybrid inference." Show the repo + hosted URL on screen.

## AI-assistance disclosure (for the submission)

This project was built with AI coding assistance (Muse). All application code was written during the submission period for this contest; no pre-existing project code was incorporated. Third-party code is limited to the Firebase JS SDK and Vite (npm dependencies, their own licenses).
