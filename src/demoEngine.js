/**
 * demoEngine.js — CLEARLY-LABELLED stand-in engine, used ONLY when the app
 * has no Firebase config (no .env). It lets anyone explore the full UI and
 * demo flow without a Firebase project, and it mimics the hybrid router's
 * contract exactly (same shapes, same `source` values, simulated latency).
 *
 * It is NEVER used when a Firebase config is present — then every AI call
 * goes through Firebase AI Logic (see ai.js). The UI shows a permanent
 * "DEMO MODE — add Firebase config for real AI" banner whenever this
 * engine is active, so demo output can never be mistaken for real AI.
 *
 * The sample analyses are deterministic, keyed off the crop the scout
 * picked, so the demo is repeatable.
 */

const SAMPLES = {
  maize: {
    crop: "Maize",
    symptoms: ["grey-green lesions on lower leaves", "lesions turning tan with dark borders", "yellowing spreading upward"],
    likelyIssue: "Northern corn leaf blight",
    category: "fungal",
    severity: 3,
    confidence: 0.78,
    immediateAction: "Remove the worst-affected lower leaves and avoid overhead watering for a week.",
    needsExpertReview: false,
    distinguishingFeatures: ["cigar-shaped lesions", "lesions follow leaf veins", "grey-green centres"],
  },
  cassava: {
    crop: "Cassava",
    symptoms: ["yellow mosaic pattern on young leaves", "leaf distortion and curling", "stunted new growth"],
    likelyIssue: "Cassava mosaic disease",
    category: "viral",
    severity: 4,
    confidence: 0.82,
    immediateAction: "Rogue out infected plants now and do not take cuttings from this plot.",
    needsExpertReview: true,
    distinguishingFeatures: ["mosaic mottling", "curled leaf edges", "worse on young leaves"],
  },
  tomato: {
    crop: "Tomato",
    symptoms: ["dark water-soaked spots on lower leaves", "white fuzzy growth under leaves", "rapid wilting after rain"],
    likelyIssue: "Late blight",
    category: "fungal",
    severity: 4,
    confidence: 0.81,
    immediateAction: "Apply a protectant fungicide today and improve airflow by staking plants.",
    needsExpertReview: true,
    distinguishingFeatures: ["water-soaked spots", "fuzzy undersides", "fast spread after rain"],
  },
  rice: {
    crop: "Rice",
    symptoms: ["diamond-shaped spots with grey centres", "spots on leaves and neck", "lodging in patches"],
    likelyIssue: "Rice blast",
    category: "fungal",
    severity: 3,
    confidence: 0.76,
    immediateAction: "Drain the field for 2-3 days and hold off nitrogen fertilizer.",
    needsExpertReview: false,
    distinguishingFeatures: ["spindle-shaped lesions", "grey centres", "neck infection"],
  },
};

const DEFAULT_SAMPLE = {
  crop: "Unknown crop",
  symptoms: ["leaf discolouration", "irregular spots on foliage"],
  likelyIssue: "Unidentified leaf issue — needs a closer look",
  category: "unknown",
  severity: 2,
  confidence: 0.45,
  immediateAction: "Take a closer, well-lit photo of one affected leaf and re-run the analysis.",
  needsExpertReview: true,
  distinguishingFeatures: ["discolouration", "spotting"],
};

const SAMPLE_REPORT = {
  diagnosis: "Fungal leaf infection consistent with the field analysis.",
  differentialDiagnoses: [
    "Bacterial leaf spot (less likely — no water-soaked margins)",
    "Nutrient deficiency (less likely — pattern follows veins, not whole-leaf yellowing)",
  ],
  treatmentPlan: [
    "Remove and destroy the most affected leaves; do not compost them.",
    "Apply a locally available protectant fungicide, following the label rate.",
    "Water at the base in the morning; keep foliage dry in the evening.",
    "Re-scout in 5 days and compare severity.",
  ],
  prevention: [
    "Rotate crops next season — do not plant the same family in this plot.",
    "Space plants for airflow and stake to keep leaves off the soil.",
    "Use certified disease-free seed or cuttings.",
  ],
  safetyNotes: [
    "Wear gloves and eye protection when applying fungicide.",
    "Observe the label's pre-harvest interval before eating or selling.",
  ],
  urgency: "act_this_week",
  estimatedYieldImpact: "5–15% if untreated; under 5% if treated this week.",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class DemoEngine {
  constructor() {
    this.mode = "prefer_on_device";
    this.deviceReady = true;
    this.isDemo = true;
  }

  setMode(mode) {
    this.mode = mode;
  }

  async deviceAvailability() {
    return "available";
  }

  async prepareDevice(onProgress) {
    if (typeof onProgress === "function") {
      for (const value of [0.25, 0.6, 0.9, 1]) {
        onProgress(value);
        await sleep(120);
      }
    }
  }

  pickSample(crop) {
    const key = String(crop || "").toLowerCase();
    for (const [name, sample] of Object.entries(SAMPLES)) {
      if (key.includes(name)) return sample;
    }
    return DEFAULT_SAMPLE;
  }

  async analyze({ crop }) {
    const started = performance.now();
    await sleep(900);
    const onDevice = this.mode !== "only_in_cloud";
    return {
      analysis: { ...this.pickSample(crop) },
      repairs: [],
      source: onDevice ? "on_device" : "in_cloud",
      latencyMs: Math.round(performance.now() - started),
      usage: null,
      demo: true,
    };
  }

  async deepReport() {
    const started = performance.now();
    await sleep(1400);
    return {
      report: { ...SAMPLE_REPORT },
      repairs: [],
      source: "in_cloud",
      latencyMs: Math.round(performance.now() - started),
      usage: { promptTokenCount: 812, candidatesTokenCount: 466, totalTokenCount: 1278 },
      demo: true,
    };
  }
}
