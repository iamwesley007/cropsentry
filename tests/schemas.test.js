import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANALYSIS_SCHEMA,
  REPORT_SCHEMA,
  extractJson,
  validateAnalysis,
  validateReport,
} from "../src/schemas.js";

test("schemas declare the required fields", () => {
  assert.deepEqual(ANALYSIS_SCHEMA.required, [
    "crop",
    "symptoms",
    "likelyIssue",
    "category",
    "severity",
    "confidence",
    "immediateAction",
    "needsExpertReview",
  ]);
  assert.equal(ANALYSIS_SCHEMA.properties.severity.minimum, 1);
  assert.equal(ANALYSIS_SCHEMA.properties.severity.maximum, 5);
  assert.ok(REPORT_SCHEMA.required.includes("treatmentPlan"));
  assert.ok(REPORT_SCHEMA.required.includes("urgency"));
});

test("extractJson parses a bare JSON object", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
});

test("extractJson unwraps markdown fences", () => {
  assert.deepEqual(extractJson('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('```\n{"a":3}\n```'), { a: 3 });
});

test("extractJson finds JSON inside prose", () => {
  assert.deepEqual(extractJson('Here is the result: {"a":4} hope that helps.'), { a: 4 });
});

test("extractJson returns null for garbage", () => {
  assert.equal(extractJson("no json here"), null);
  assert.equal(extractJson(""), null);
  assert.equal(extractJson(null), null);
  assert.equal(extractJson('{"broken": '), null);
});

test("validateAnalysis accepts a complete analysis", () => {
  const { analysis, valid, repairs } = validateAnalysis({
    crop: "Maize",
    symptoms: ["spots"],
    likelyIssue: "Leaf blight",
    category: "fungal",
    severity: 3,
    confidence: 0.8,
    immediateAction: "Remove leaves.",
    needsExpertReview: false,
    distinguishingFeatures: ["lesions"],
  });
  assert.equal(valid, true);
  assert.deepEqual(repairs, []);
  assert.equal(analysis.severity, 3);
  assert.equal(analysis.confidence, 0.8);
});

test("validateAnalysis repairs bad values without throwing", () => {
  const { analysis, valid, repairs } = validateAnalysis({
    crop: "",
    symptoms: "not an array",
    likelyIssue: "",
    category: "alien",
    severity: 99,
    confidence: 5,
    immediateAction: "",
    needsExpertReview: "yes",
  });
  assert.equal(valid, false);
  assert.ok(repairs.length > 0);
  assert.equal(analysis.category, "unknown");
  assert.equal(analysis.severity, 5);
  assert.equal(analysis.confidence, 1);
  assert.equal(analysis.crop, "Unknown crop");
  assert.deepEqual(analysis.symptoms, []);
  assert.equal(analysis.needsExpertReview, true);
});

test("validateAnalysis handles unparseable input", () => {
  const { analysis, valid } = validateAnalysis(null);
  assert.equal(valid, false);
  assert.equal(analysis.severity, 3);
  assert.equal(analysis.confidence, 0.5);
});

test("validateReport accepts a complete report", () => {
  const { report, valid } = validateReport({
    diagnosis: "Blight",
    differentialDiagnoses: ["Other"],
    treatmentPlan: ["Step one"],
    prevention: ["Rotate"],
    safetyNotes: [],
    urgency: "act_this_week",
    estimatedYieldImpact: "5%",
  });
  assert.equal(valid, true);
  assert.equal(report.urgency, "act_this_week");
  assert.deepEqual(report.safetyNotes, []);
});

test("validateReport repairs a bad urgency value", () => {
  const { report, valid, repairs } = validateReport({
    diagnosis: "X",
    treatmentPlan: ["Y"],
    urgency: "sometime",
  });
  assert.equal(valid, false);
  assert.ok(repairs.includes("urgency"));
  assert.equal(report.urgency, "monitor");
});
