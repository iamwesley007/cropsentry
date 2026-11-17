/**
 * main.js — CropSentry app wiring.
 *
 * Flow: photo + crop + notes -> (user gesture) prepare on-device model ->
 * hybrid field analysis (Firebase AI Logic) -> structured result card ->
 * optional cloud agronomist report -> field log (local + Firestore).
 */
import { isConfigured, isLocalhost } from "./config.js";
import { initFirebase, currentUid, warmAppCheck } from "./firebase.js";
import { HybridEngine, MODES, MODE_LABELS, fileToPart, explainAiError } from "./ai.js";
import { DemoEngine } from "./demoEngine.js";
import { FieldLog, loadStats, recordInference, recordReport } from "./store.js";
import { SEVERITY_LABELS } from "./schemas.js";

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatLatency(ms) {
  if (ms == null) return "";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function formatTokens(usage) {
  if (!usage || typeof usage.totalTokenCount !== "number") return null;
  return `${usage.totalTokenCount.toLocaleString()} cloud tokens`;
}

/** Draw a synthetic diseased-leaf photo so the demo flow works with no files. */
function makeSamplePhoto() {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext("2d");

  // Soil background.
  const soil = ctx.createLinearGradient(0, 0, 0, 480);
  soil.addColorStop(0, "#7a5a38");
  soil.addColorStop(1, "#5d4023");
  ctx.fillStyle = soil;
  ctx.fillRect(0, 0, 640, 480);

  // Leaf body.
  ctx.save();
  ctx.translate(320, 240);
  ctx.rotate(-0.35);
  const leaf = ctx.createLinearGradient(-260, 0, 260, 0);
  leaf.addColorStop(0, "#2f7a33");
  leaf.addColorStop(0.5, "#43a047");
  leaf.addColorStop(1, "#2e7d32");
  ctx.fillStyle = leaf;
  ctx.beginPath();
  ctx.moveTo(-260, 0);
  ctx.bezierCurveTo(-120, -130, 120, -130, 260, 0);
  ctx.bezierCurveTo(120, 130, -120, 130, -260, 0);
  ctx.fill();
  // Vein.
  ctx.strokeStyle = "#c8e6c9";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-250, 0);
  ctx.lineTo(250, 0);
  ctx.stroke();
  ctx.lineWidth = 2;
  for (let i = -3; i <= 3; i += 1) {
    ctx.beginPath();
    ctx.moveTo(i * 60, 0);
    ctx.lineTo(i * 60 + 45, i % 2 === 0 ? -55 : 55);
    ctx.stroke();
  }
  // Lesions (seeded positions so the sample is stable).
  const spots = [
    [60, -35, 34, "#8d6e3f"],
    [120, 25, 26, "#a1887f"],
    [-40, 45, 30, "#795548"],
    [170, -10, 20, "#8d6e3f"],
    [-130, -30, 24, "#a1887f"],
    [20, -60, 18, "#6d4c41"],
  ];
  for (const [x, y, r, color] of spots) {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.7, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#4e342e";
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.45, r * 0.3, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(new File([blob], "sample-leaf.jpg", { type: "image/jpeg" })),
      "image/jpeg",
      0.9
    );
  });
}

function dataUrlToPart(dataUrl) {
  const [header, data] = dataUrl.split(",");
  const mimeType = /data:(.*?);/.exec(header)?.[1] || "image/jpeg";
  return { type: "inlineData", inlineData: { data, mimeType } };
}

const state = {
  engine: null,
  log: null,
  photoFile: null,
  photoDataUrl: null,
  currentEntry: null,
  analyzing: false,
  reporting: false,
};

function setPill(element, text, kind) {
  element.textContent = text;
  element.className = `pill pill-${kind}`;
}

function renderStats() {
  const stats = loadStats();
  $("statOnDevice").textContent = stats.onDevice;
  $("statInCloud").textContent = stats.inCloud;
  $("statTokens").textContent = stats.cloudTokens.toLocaleString();
  $("statReports").textContent = stats.reports;
}

async function refreshAvailability() {
  const availability = await state.engine.deviceAvailability();
  const labels = {
    available: "On-device model is ready in this browser.",
    downloadable: "On-device model can be downloaded (first use).",
    downloading: "On-device model is downloading…",
    unavailable: "On-device model is not available on this device/browser.",
    unsupported: "This browser does not expose an on-device model — cloud fallback will be used.",
  };
  $("availabilityText").textContent = labels[availability] || labels.unsupported;
  setPill(
    $("enginePill"),
    availability === "available"
      ? "Engine: on-device ready"
      : availability === "unsupported" || availability === "unavailable"
        ? "Engine: cloud fallback"
        : "Engine: on-device downloadable",
    availability === "available" ? "ok" : "muted"
  );
  return availability;
}

function severityDots(severity) {
  const dots = [];
  for (let i = 1; i <= 5; i += 1) {
    const cls =
      i <= severity ? (severity <= 2 ? "on-low" : severity === 3 ? "on-mid" : "on-high") : "";
    dots.push(`<span class="severity-dot ${cls}"></span>`);
  }
  return dots.join("");
}

function routeBadge(source, latencyMs, usage, demo) {
  const label =
    source === "on_device"
      ? "Analyzed on-device"
      : source === "in_cloud"
        ? "Analyzed in the cloud"
        : "Analysis complete";
  const cls = source === "on_device" ? "route-on-device" : source === "in_cloud" ? "route-in-cloud" : "route-unknown";
  const bits = [label, formatLatency(latencyMs)];
  const tokens = formatTokens(usage);
  if (tokens) bits.push(tokens);
  if (source === "on_device") bits.push("0 cloud tokens · private");
  if (demo) bits.push("demo sample");
  return `<span class="route-badge ${cls}">${esc(bits.filter(Boolean).join(" · "))}</span>`;
}

function renderAnalysis(entry) {
  const { analysis, source, latencyMs, usage, demo } = entry;
  const confidencePct = Math.round(analysis.confidence * 100);
  return `
    ${routeBadge(source, latencyMs, usage, demo)}
    <h3 class="result-title">${esc(analysis.likelyIssue)}</h3>
    <p class="muted">${esc(analysis.crop)}${entry.plot ? ` · ${esc(entry.plot)}` : ""}</p>
    <div class="severity-meter" aria-label="Severity ${analysis.severity} of 5">
      ${severityDots(analysis.severity)}
      <span class="small"><strong>Severity ${analysis.severity}/5</strong> — ${esc(SEVERITY_LABELS[analysis.severity] || "")}</span>
    </div>
    <dl class="kv">
      <dt>Confidence</dt><dd>${confidencePct}%</dd>
      <dt>Category</dt><dd>${esc(analysis.category.replaceAll("_", " "))}</dd>
      <dt>Engine</dt><dd>${source === "on_device" ? "Gemini Nano, on-device (Chrome Prompt API via Firebase AI Logic)" : "Cloud Gemini via Firebase AI Logic"}</dd>
    </dl>
    <h4 class="field-label">Visible symptoms</h4>
    <ul class="chip-list">${analysis.symptoms.map((s) => `<li>${esc(s)}</li>`).join("") || "<li>None noted</li>"}</ul>
    <h4 class="field-label">What points to this</h4>
    <ul class="chip-list">${analysis.distinguishingFeatures.map((s) => `<li>${esc(s)}</li>`).join("") || "<li>—</li>"}</ul>
    <div class="action-box"><strong>Do this now</strong>${esc(analysis.immediateAction)}</div>
    ${analysis.needsExpertReview ? `<div class="expert-flag">⚠️ This case is flagged for expert review — consider the full agronomist report below.</div>` : ""}
    ${entry.notes ? `<p class="small muted">Scout's notes: ${esc(entry.notes)}</p>` : ""}
  `;
}

function renderReport(report, meta) {
  const urgencyLabels = {
    monitor: "Monitor",
    act_this_week: "Act this week",
    act_within_48h: "Act within 48 hours",
    act_now: "Act now",
  };
  return `
    <div class="report">
      ${routeBadge("in_cloud", meta.latencyMs, meta.usage, meta.demo)}
      <h3>Agronomist report</h3>
      <p><strong>Diagnosis:</strong> ${esc(report.diagnosis)}</p>
      <h4>Treatment plan</h4>
      <ul>${report.treatmentPlan.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
      <h4>Other possible causes</h4>
      <ul>${report.differentialDiagnoses.map((s) => `<li>${esc(s)}</li>`).join("") || "<li>None listed</li>"}</ul>
      <h4>Prevention</h4>
      <ul>${report.prevention.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
      ${report.safetyNotes.length ? `<h4>Safety notes</h4><ul>${report.safetyNotes.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
      <p class="report-meta">Urgency: <strong>${esc(urgencyLabels[report.urgency] || report.urgency)}</strong> · Estimated yield impact: ${esc(report.estimatedYieldImpact)}</p>
    </div>
  `;
}

function showResult(entry) {
  $("resultEmpty").hidden = true;
  $("resultBusy").hidden = true;
  const body = $("resultBody");
  body.hidden = false;
  body.innerHTML =
    renderAnalysis(entry) +
    (entry.report
      ? renderReport(entry.report, entry.reportMeta || {})
      : `<button id="reportBtn" class="btn btn-secondary" type="button">Get the full agronomist report (cloud)</button>
         <p class="field-help">Runs the bigger cloud model for diagnosis, treatment, and prevention. The field analysis above stays on-device.</p>
         <p id="reportError" class="error" role="alert" hidden></p>`);
  const reportBtn = $("reportBtn");
  if (reportBtn) reportBtn.addEventListener("click", () => runReport(entry));
}

function showBusy(text) {
  $("resultEmpty").hidden = true;
  $("resultBody").hidden = true;
  $("resultBusy").hidden = false;
  $("busyText").textContent = text;
}

function renderLog() {
  const entries = state.log.list();
  $("logCount").textContent = `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`;
  $("logEmpty").hidden = entries.length > 0;
  const list = $("logList");
  list.innerHTML = "";
  for (const entry of entries) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "log-card";
    card.innerHTML = `
      ${entry.photo ? `<img src="${esc(entry.photo)}" alt="" />` : ""}
      <span class="log-card-body">
        <strong>${esc(entry.analysis.likelyIssue)}</strong>
        <span class="muted">${esc(entry.analysis.crop)} · ${new Date(entry.createdAt).toLocaleString()}</span>
        <span class="log-badges">
          <span class="mini-badge ${entry.source === "in_cloud" ? "cloud" : ""}">${entry.source === "on_device" ? "On-device" : "Cloud"}</span>
          <span class="mini-badge sev-${entry.analysis.severity}">Severity ${entry.analysis.severity}/5</span>
          ${entry.report ? `<span class="mini-badge">Report</span>` : ""}
          ${entry.synced ? `<span class="mini-badge">Synced</span>` : ""}
        </span>
      </span>`;
    card.addEventListener("click", () => {
      state.currentEntry = entry;
      showResult(entry);
      $("resultPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    list.appendChild(card);
  }
}

async function runReport(entry) {
  if (state.reporting) return;
  state.reporting = true;
  const btn = $("reportBtn");
  const errorEl = $("reportError");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Running cloud report…";
  }
  if (errorEl) errorEl.hidden = true;
  try {
    const imagePart = entry.photo
      ? dataUrlToPart(entry.photo)
      : null;
    if (!imagePart) throw new Error("No photo stored for this entry.");
    const result = await state.engine.deepReport({
      imagePart,
      analysis: entry.analysis,
      crop: entry.analysis.crop,
      notes: entry.notes,
    });
    recordReport();
    recordInference(result.source, result.usage);
    const updated = await state.log.update(entry.id, {
      report: result.report,
      reportMeta: {
        latencyMs: result.latencyMs,
        usage: result.usage,
        demo: Boolean(result.demo),
      },
    });
    state.currentEntry = updated || { ...entry, report: result.report };
    renderStats();
    renderLog();
    showResult(state.currentEntry);
  } catch (error) {
    console.error(error);
    if (errorEl) {
      errorEl.textContent = explainAiError(error);
      errorEl.hidden = false;
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Get the full agronomist report (cloud)";
    }
  } finally {
    state.reporting = false;
  }
}

async function runAnalysis() {
  if (state.analyzing || !state.photoFile) return;
  state.analyzing = true;
  const btn = $("analyzeBtn");
  const errorEl = $("analyzeError");
  errorEl.hidden = true;
  btn.disabled = true;
  btn.textContent = "Analyzing…";
  try {
    // User gesture: prepare the on-device model first (required by the
    // Prompt API), with progress shown in the engine panel.
    showBusy("Preparing the on-device model…");
    try {
      await state.engine.prepareDevice((value) => {
        const progress = $("downloadProgress");
        progress.hidden = false;
        progress.value = value;
        $("prepareStatus").textContent = `Downloading model… ${Math.round(value * 100)}%`;
      });
      $("prepareStatus").textContent = "On-device model ready.";
    } catch (error) {
      // Device init failing must not block the cloud fallback.
      $("prepareStatus").textContent = "On-device model unavailable — cloud fallback will be used.";
      console.warn(error);
    }

    showBusy("Reading the leaf…");
    const { part: imagePart, dataUrl } = await fileToPart(state.photoFile);
    const crop = $("cropInput").value.trim();
    const notes = $("notesInput").value.trim();
    const plot = $("plotInput").value.trim();
    const result = await state.engine.analyze({
      imagePart,
      crop,
      notes,
    });
    recordInference(result.source, result.usage);
    const entry = await state.log.add({
      crop: crop || result.analysis.crop,
      notes,
      plot,
      photo: dataUrl,
      analysis: result.analysis,
      source: result.source,
      latencyMs: result.latencyMs,
      usage: result.usage,
      mode: state.engine.mode,
      demo: Boolean(result.demo),
      report: null,
    });
    state.currentEntry = entry;
    renderStats();
    renderLog();
    showResult(entry);
  } catch (error) {
    console.error(error);
    errorEl.textContent = explainAiError(error);
    errorEl.hidden = false;
    $("resultEmpty").hidden = false;
    $("resultBusy").hidden = true;
  } finally {
    state.analyzing = false;
    btn.disabled = !state.photoFile;
    btn.textContent = "Analyze on-device";
  }
}

function setPhoto(file) {
  if (!file || !file.type.startsWith("image/")) return;
  state.photoFile = file;
  const reader = new FileReader();
  reader.onloadend = () => {
    state.photoDataUrl = reader.result;
    $("photoPreview").src = reader.result;
    $("photoPreview").hidden = false;
    $("dropzoneEmpty").hidden = true;
    $("clearPhotoBtn").hidden = false;
    $("analyzeBtn").disabled = false;
    $("analyzeHint").textContent = "Ready — the analysis runs on-device first.";
  };
  reader.readAsDataURL(file);
}

function clearPhoto() {
  state.photoFile = null;
  state.photoDataUrl = null;
  $("photoInput").value = "";
  $("photoPreview").hidden = true;
  $("photoPreview").removeAttribute("src");
  $("dropzoneEmpty").hidden = false;
  $("clearPhotoBtn").hidden = true;
  $("analyzeBtn").disabled = true;
  $("analyzeHint").textContent = "Add a photo to start the analysis.";
}

async function boot() {
  renderStats();

  if (!isConfigured) {
    $("demoBanner").hidden = false;
    setPill($("configPill"), "Config: demo mode", "warn");
    state.engine = new DemoEngine();
    state.log = new FieldLog({ db: null, uid: null });
  } else {
    setPill($("configPill"), "Config: Firebase connected", "ok");
    const { app, db } = await initFirebase();
    state.engine = new HybridEngine(app);
    const uid = await currentUid();
    state.log = new FieldLog({ db, uid });
    warmAppCheck();
    state.log.syncFromFirestore().then(renderLog);
  }

  renderLog();
  await refreshAvailability();

  // Mode switcher.
  $("modeSelect").addEventListener("change", (event) => {
    state.engine.setMode(event.target.value);
    const label = MODE_LABELS[event.target.value];
    $("analyzeBtn").textContent =
      event.target.value === MODES.ONLY_IN_CLOUD || event.target.value === MODES.PREFER_IN_CLOUD
        ? "Analyze (cloud-first)"
        : "Analyze on-device";
    $("analyzeHint").textContent = `Mode: ${label}.`;
  });

  // Explicit device preparation (also happens inside Analyze).
  $("prepareBtn").addEventListener("click", async () => {
    const btn = $("prepareBtn");
    btn.disabled = true;
    $("prepareStatus").textContent = "Preparing…";
    try {
      await state.engine.prepareDevice((value) => {
        const progress = $("downloadProgress");
        progress.hidden = false;
        progress.value = value;
        $("prepareStatus").textContent = `Downloading model… ${Math.round(value * 100)}%`;
      });
      $("prepareStatus").textContent = "On-device model ready.";
      await refreshAvailability();
    } catch (error) {
      $("prepareStatus").textContent = "Could not prepare the on-device model here.";
      console.warn(error);
    } finally {
      btn.disabled = false;
    }
  });

  // Photo input: click, keyboard, drag & drop.
  const dropzone = $("dropzone");
  const photoInput = $("photoInput");
  dropzone.addEventListener("click", () => photoInput.click());
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      photoInput.click();
    }
  });
  photoInput.addEventListener("change", () => {
    if (photoInput.files[0]) setPhoto(photoInput.files[0]);
  });
  for (const eventName of ["dragenter", "dragover"]) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add("dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove("dragging");
    });
  }
  dropzone.addEventListener("drop", (event) => {
    const file = event.dataTransfer.files[0];
    if (file) setPhoto(file);
  });
  $("clearPhotoBtn").addEventListener("click", clearPhoto);
  $("sampleBtn").addEventListener("click", async () => {
    const file = await makeSamplePhoto();
    setPhoto(file);
    if (!$("cropInput").value.trim()) $("cropInput").value = "Maize";
  });

  $("analyzeBtn").addEventListener("click", runAnalysis);

  if (isConfigured && isLocalhost) {
    console.info(
      "[CropSentry] Localhost build: App Check debug provider is active. " +
        "If inference is blocked, safelist the debug token printed in this console (see SETUP.md)."
    );
  }
}

boot();
