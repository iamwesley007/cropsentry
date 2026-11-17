/**
 * ai.js — the hybrid inference engine.
 *
 * Everything AI in CropSentry goes through Firebase AI Logic's hybrid
 * inference (firebase/ai), verified against the Firebase AI Logic SDK
 * v13.4.0 typings and the official hybrid-inference docs:
 *
 *   const ai = getAI(app, { backend: new GoogleAIBackend() });
 *   const model = getGenerativeModel(ai, {
 *     mode: InferenceMode.PREFER_ON_DEVICE,
 *     inCloudParams: { model: "gemini-3.8-flash", generationConfig, ... },
 *   });
 *   await model.initializeDeviceModel(onProgress);  // after a user gesture
 *   const result = await model.generateContent([prompt, imagePart]);
 *   result.response.text();            // model output
 *   result.response.inferenceSource;   // "on_device" | "in_cloud"
 *
 * Two tasks, two routing strategies:
 *  1. Field analysis — the scout's everyday task. Runs under the user's
 *     chosen hybrid mode (default PREFER_ON_DEVICE): Gemini Nano on-device
 *     in desktop Chrome when available, cloud Gemini otherwise. Structured
 *     JSON output, identical shape on both paths.
 *  2. Agronomist report — the deep dive. Runs ONLY_IN_CLOUD, because it
 *     needs the bigger model's reasoning and the scout explicitly asked
 *     for the escalation. The hybrid switch is visible and meaningful:
 *     fast/private/free on-device first, depth on demand.
 */
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
} from "firebase/ai";
import { cloudModel } from "./config.js";
import {
  ANALYSIS_SCHEMA,
  REPORT_SCHEMA,
  extractJson,
  validateAnalysis,
  validateReport,
} from "./schemas.js";

export const MODES = {
  PREFER_ON_DEVICE: InferenceMode.PREFER_ON_DEVICE,
  ONLY_ON_DEVICE: InferenceMode.ONLY_ON_DEVICE,
  PREFER_IN_CLOUD: InferenceMode.PREFER_IN_CLOUD,
  ONLY_IN_CLOUD: InferenceMode.ONLY_IN_CLOUD,
};

export const MODE_LABELS = {
  [MODES.PREFER_ON_DEVICE]: "Prefer on-device",
  [MODES.ONLY_ON_DEVICE]: "On-device only",
  [MODES.PREFER_IN_CLOUD]: "Prefer cloud",
  [MODES.ONLY_IN_CLOUD]: "Cloud only",
};

const ANALYSIS_SYSTEM =
  "You are a crop health scout assistant. Assess the plant in the photo " +
  "and return ONLY the JSON object matching the required schema. Be " +
  "conservative: when unsure, say so with lower confidence and flag " +
  "needsExpertReview. Use plain, practical language a field worker " +
  "understands. Never invent treatments you are unsure about.";

const REPORT_SYSTEM =
  "You are an experienced agronomist writing a field report from a scout's " +
  "on-device analysis and photo. Return ONLY the JSON object matching the " +
  "required schema. Be specific and practical: named products only when " +
  "they are standard, widely available treatments, with safety notes. " +
  "Account for smallholder farming realities: low-cost, locally available " +
  "options first.";

function buildAnalysisPrompt({ crop, notes }) {
  const lines = [
    "Assess this crop photo and return the structured field analysis.",
    `Reported crop: ${crop || "not specified — identify it from the photo"}.`,
  ];
  if (notes) lines.push(`Scout's notes: ${notes}`);
  lines.push(
    "Describe only what you can actually see. If the photo does not clearly show a plant problem, say so."
  );
  return lines.join("\n");
}

function buildReportPrompt({ analysis, crop, notes }) {
  const lines = [
    "Write the full agronomist report for this case.",
    `Crop: ${crop || analysis.crop}.`,
    `On-device field analysis: ${JSON.stringify(analysis)}`,
  ];
  if (notes) lines.push(`Scout's notes: ${notes}`);
  lines.push(
    "Use the photo plus the analysis above. Give a diagnosis, other plausible causes, an ordered treatment plan, prevention, safety notes, urgency, and a plain-language yield-impact estimate."
  );
  return lines.join("\n");
}

/**
 * Convert an uploaded file into a model Part. On-device inference only
 * accepts JPEG/PNG, so anything else (WebP, HEIC exports, huge files) is
 * re-encoded to JPEG and downscaled to 1024px on the long edge via canvas.
 * Returns { part, dataUrl, converted } — dataUrl is kept for the log entry.
 */
export async function fileToPart(file) {
  const MAX_EDGE = 1024;
  const needsConvert =
    !["image/jpeg", "image/png"].includes(file.type) || file.size > 1_500_000;

  const readAsDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  if (!needsConvert) {
    const dataUrl = await readAsDataUrl(file);
    return {
      part: {
        type: "inlineData",
        inlineData: { data: dataUrl.split(",")[1], mimeType: file.type },
      },
      dataUrl,
      converted: false,
    };
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return {
    part: {
      type: "inlineData",
      inlineData: { data: dataUrl.split(",")[1], mimeType: "image/jpeg" },
    },
    dataUrl,
    converted: true,
  };
}

/** Friendly message for the errors the hybrid SDK actually throws. */
export function explainAiError(error) {
  const message = String((error && error.message) || error || "");
  if (/only_on_device|on-device.*not available|device model/i.test(message))
    return "On-device AI is not available in this browser. Switch to “Prefer on-device” to allow the cloud fallback, or use desktop Chrome 139+ with the Prompt API flag enabled.";
  if (/app check|appcheck|403/i.test(message))
    return "The request was blocked by Firebase App Check. On localhost, register the debug token printed in the console (see SETUP.md step 5).";
  if (/quota|429|resource_exhausted/i.test(message))
    return "The cloud model quota is exhausted right now. On-device analysis still works — switch to “On-device only” and keep scouting.";
  if (/network|fetch failed|failed to fetch/i.test(message))
    return "No network connection. On-device analysis works offline in desktop Chrome — switch to “On-device only”.";
  if (/blocked|harm|safety/i.test(message))
    return "The model declined this photo. Try a clearer photo of the affected plant part.";
  return message || "The AI request failed for an unknown reason.";
}

export class HybridEngine {
  constructor(firebaseApp) {
    this.ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
    this.mode = MODES.PREFER_ON_DEVICE;
    this.models = new Map();
    this.deviceReady = false;
    this.deviceInitStarted = false;
  }

  setMode(mode) {
    if (!Object.values(MODES).includes(mode)) return;
    this.mode = mode;
  }

  /** Build (and cache) a hybrid model for a task + mode combination. */
  modelFor(kind) {
    const key = `${kind}:${this.mode}`;
    if (this.models.has(key)) return this.models.get(key);

    const isReport = kind === "report";
    const model = getGenerativeModel(this.ai, {
      // Reports always run in the cloud: the scout explicitly escalated.
      mode: isReport ? MODES.ONLY_IN_CLOUD : this.mode,
      inCloudParams: {
        model: cloudModel,
        systemInstruction: isReport ? REPORT_SYSTEM : ANALYSIS_SYSTEM,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: isReport ? REPORT_SCHEMA : ANALYSIS_SCHEMA,
        },
      },
    });
    this.models.set(key, model);
    return model;
  }

  /**
   * Probe the Chrome Prompt API directly for the status panel. This only
   * READS availability — inference itself always goes through Firebase AI
   * Logic. Returns one of: available | downloadable | downloading |
   * unavailable | unsupported.
   */
  async deviceAvailability() {
    try {
      const LM = globalThis.LanguageModel;
      if (!LM || typeof LM.availability !== "function") return "unsupported";
      const state = await LM.availability();
      return ["available", "downloadable", "downloading"].includes(state)
        ? state
        : "unavailable";
    } catch {
      return "unsupported";
    }
  }

  /**
   * Initialize the on-device model. MUST be called from a user gesture
   * (button click) and before the first inference call. Safe to call
   * repeatedly; subsequent calls are no-ops. Reports download progress
   * (0..1) via onProgress.
   */
  async prepareDevice(onProgress) {
    if (this.deviceReady || this.deviceInitStarted) return;
    this.deviceInitStarted = true;
    try {
      const model = this.modelFor("analysis");
      await model.initializeDeviceModel((value) => {
        if (typeof onProgress === "function") onProgress(value);
      });
      this.deviceReady = true;
    } catch (error) {
      // A failed device init must not block cloud fallback.
      this.deviceInitStarted = false;
      console.warn("[CropSentry] Device model init failed:", error);
      throw error;
    }
  }

  /**
   * Run the field analysis. Returns { analysis, source, latencyMs,
   * usage, repairs } where source is "on_device" | "in_cloud".
   */
  async analyze({ imagePart, crop, notes }) {
    const model = this.modelFor("analysis");
    const started = performance.now();
    const result = await model.generateContent([
      buildAnalysisPrompt({ crop, notes }),
      imagePart,
    ]);
    const latencyMs = Math.round(performance.now() - started);
    const response = result.response;
    const text = response.text();
    const { analysis, repairs } = validateAnalysis(extractJson(text));
    return {
      analysis,
      repairs,
      source: response.inferenceSource || "unknown",
      latencyMs,
      usage: response.usageMetadata || null,
    };
  }

  /**
   * Run the deep agronomist report (cloud only). Returns { report, source,
   * latencyMs, usage, repairs }.
   */
  async deepReport({ imagePart, analysis, crop, notes }) {
    const model = this.modelFor("report");
    const started = performance.now();
    const result = await model.generateContent([
      buildReportPrompt({ analysis, crop, notes }),
      imagePart,
    ]);
    const latencyMs = Math.round(performance.now() - started);
    const response = result.response;
    const text = response.text();
    const { report, repairs } = validateReport(extractJson(text));
    return {
      report,
      repairs,
      source: response.inferenceSource || "in_cloud",
      latencyMs,
      usage: response.usageMetadata || null,
    };
  }
}
