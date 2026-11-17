/**
 * schemas.js — structured-output contracts shared by BOTH inference paths.
 *
 * The whole point of the hybrid design is that on-device and cloud produce
 * the SAME shape, so the UI, the store, and the validators never care which
 * engine answered. These schemas are passed to Firebase AI Logic as
 * `generationConfig.responseSchema` (application/json) and are also used to
 * validate + normalize whatever text comes back, because on-device output
 * is not always schema-perfect.
 *
 * This module is pure (no Firebase imports) so it can be unit-tested in Node.
 */

export const SEVERITY_LABELS = {
  1: "Healthy / trace",
  2: "Mild",
  3: "Moderate",
  4: "Severe",
  5: "Critical",
};

export const ISSUE_CATEGORIES = [
  "fungal",
  "bacterial",
  "viral",
  "pest",
  "nutrient_deficiency",
  "water_stress",
  "physical_damage",
  "healthy",
  "unknown",
];

/**
 * JSON Schema (plain-object form) for the on-device field analysis.
 * Passed to the model as responseSchema; also used by validateAnalysis().
 */
export const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    crop: { type: "string", description: "Crop or plant identified in the photo." },
    symptoms: {
      type: "array",
      items: { type: "string" },
      description: "Visible symptoms, each a short phrase.",
    },
    likelyIssue: {
      type: "string",
      description: "Most likely issue in plain words, e.g. 'bacterial leaf blight'.",
    },
    category: {
      type: "string",
      enum: ISSUE_CATEGORIES,
      description: "Broad category of the issue.",
    },
    severity: {
      type: "integer",
      minimum: 1,
      maximum: 5,
      description: "1 = healthy/trace, 5 = critical. Judge by spread and damage.",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "How confident the assessment is, 0 to 1.",
    },
    immediateAction: {
      type: "string",
      description: "One concrete thing to do right now, in plain language.",
    },
    needsExpertReview: {
      type: "boolean",
      description: "True when the case is severe, uncertain, or fast-spreading.",
    },
    distinguishingFeatures: {
      type: "array",
      items: { type: "string" },
      description: "2-4 visual clues that support the assessment.",
    },
  },
  required: [
    "crop",
    "symptoms",
    "likelyIssue",
    "category",
    "severity",
    "confidence",
    "immediateAction",
    "needsExpertReview",
  ],
};

/** JSON Schema for the deeper cloud agronomist report. */
export const REPORT_SCHEMA = {
  type: "object",
  properties: {
    diagnosis: { type: "string" },
    differentialDiagnoses: {
      type: "array",
      items: { type: "string" },
      description: "Other plausible causes, most likely first.",
    },
    treatmentPlan: {
      type: "array",
      items: { type: "string" },
      description: "Ordered treatment steps, practical and specific.",
    },
    prevention: {
      type: "array",
      items: { type: "string" },
      description: "How to stop it coming back next season.",
    },
    safetyNotes: {
      type: "array",
      items: { type: "string" },
      description: "Handling / chemical safety notes. Empty array if none apply.",
    },
    urgency: {
      type: "string",
      enum: ["monitor", "act_this_week", "act_within_48h", "act_now"],
    },
    estimatedYieldImpact: {
      type: "string",
      description: "Plain-language estimate, e.g. '5-10% if untreated'.",
    },
  },
  required: [
    "diagnosis",
    "differentialDiagnoses",
    "treatmentPlan",
    "prevention",
    "urgency",
  ],
};

/**
 * Pull a JSON object out of model text. Models sometimes wrap JSON in
 * markdown fences or add a sentence around it — handle all of that.
 * Returns the parsed object, or null when nothing parseable is found.
 */
export function extractJson(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Fast path: the whole reply is JSON.
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    /* fall through to fence/slice extraction */
  }
  // Fenced code block: ```json ... ``` or ``` ... ```
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      const parsed = JSON.parse(fence[1].trim());
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* keep going */
    }
  }
  // Last resort: slice from the first { to the last }.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* give up */
    }
  }
  return null;
}

function asString(value, fallback = "") {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 8);
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clamp01(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

/**
 * Validate + normalize a raw field analysis into the canonical shape.
 * Never throws: missing pieces get safe defaults, and the result always
 * carries `valid` plus a list of fields that had to be repaired.
 */
export function validateAnalysis(raw) {
  const repairs = [];
  const data = raw && typeof raw === "object" ? raw : {};
  if (!raw || typeof raw !== "object") repairs.push("unparseable");

  const category = ISSUE_CATEGORIES.includes(data.category)
    ? data.category
    : "unknown";
  if (data.category !== category) repairs.push("category");

  const severity = clampInt(data.severity, 1, 5, 3);
  if (Number(data.severity) !== severity) repairs.push("severity");

  const analysis = {
    crop: asString(data.crop, "Unknown crop"),
    symptoms: asStringArray(data.symptoms),
    likelyIssue: asString(data.likelyIssue, "Unidentified issue"),
    category,
    severity,
    confidence: clamp01(data.confidence, 0.5),
    immediateAction: asString(
      data.immediateAction,
      "Isolate affected plants and monitor daily."
    ),
    needsExpertReview: Boolean(data.needsExpertReview),
    distinguishingFeatures: asStringArray(data.distinguishingFeatures),
  };
  if (!data.crop) repairs.push("crop");
  if (!Array.isArray(data.symptoms) || data.symptoms.length === 0)
    repairs.push("symptoms");
  if (!data.likelyIssue) repairs.push("likelyIssue");
  if (!data.immediateAction) repairs.push("immediateAction");

  return { analysis, valid: repairs.length === 0, repairs };
}

/** Validate + normalize a raw cloud agronomist report. Same idea. */
export function validateReport(raw) {
  const repairs = [];
  const data = raw && typeof raw === "object" ? raw : {};
  if (!raw || typeof raw !== "object") repairs.push("unparseable");

  const urgencyValues = ["monitor", "act_this_week", "act_within_48h", "act_now"];
  const urgency = urgencyValues.includes(data.urgency) ? data.urgency : "monitor";
  if (data.urgency !== urgency) repairs.push("urgency");

  const report = {
    diagnosis: asString(data.diagnosis, "See field analysis."),
    differentialDiagnoses: asStringArray(data.differentialDiagnoses),
    treatmentPlan: asStringArray(data.treatmentPlan),
    prevention: asStringArray(data.prevention),
    safetyNotes: asStringArray(data.safetyNotes),
    urgency,
    estimatedYieldImpact: asString(data.estimatedYieldImpact, "Not estimated."),
  };
  if (!data.diagnosis) repairs.push("diagnosis");
  if (!Array.isArray(data.treatmentPlan) || data.treatmentPlan.length === 0)
    repairs.push("treatmentPlan");

  return { report, valid: repairs.length === 0, repairs };
}
