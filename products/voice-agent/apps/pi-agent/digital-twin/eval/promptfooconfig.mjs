import { readFileSync } from "node:fs";

import { ASSERTION_KINDS, KIND_CRITERIA, PROFILE_CRITERIA } from "../../dist/digital-twin/runtime/ingestion.js";
import { createSeleneJudgeAssertion } from "./judge-config.mjs";

const dataset = JSON.parse(readFileSync(new URL("./digital-twin-classifier.gold.json", import.meta.url), "utf8"));
const assertion = (mode, metric, extra = {}) => ({
  type: "javascript",
  value: "file://assert-classification.mjs",
  config: { mode, ...extra },
  metric,
  weight: mode === "accuracy" ? 1 : 0,
});
const classCounters = ASSERTION_KINDS.flatMap((targetClass) => [
  assertion("tp", `tp_${targetClass}`, { targetClass }),
  assertion("fp", `fp_${targetClass}`, { targetClass }),
  assertion("fn", `fn_${targetClass}`, { targetClass }),
]);
const seleneJudge = createSeleneJudgeAssertion({
  kindCriteria: KIND_CRITERIA,
  profileCriteria: PROFILE_CRITERIA,
});

const tests = dataset.cases.flatMap((testCase) => testCase.transcripts.map((transcript, index) => ({
  description: `${testCase.id}#${index + 1}`,
  vars: {
    transcript,
    expectedKind: testCase.expectedKind,
    expectedProfileField: testCase.expectedProfileField || "none",
  },
  metadata: { goldCase: testCase.id, expectedKind: testCase.expectedKind, tags: testCase.tags },
  assert: [
    assertion("valid", "valid_output"),
    assertion("accuracy", "kind_accuracy"),
    assertion("coverage", "coverage"),
    assertion("safe_acceptance", "safe_acceptance"),
    assertion("false_durable", "false_durable_candidates"),
    assertion("probability_count", "probability_count"),
    assertion("brier", "brier_sum"),
    seleneJudge,
    ...classCounters,
    ...(testCase.expectedKind === "profile_update"
      ? [assertion("profile_field", "profile_field_accuracy")]
      : []),
  ],
})));

const providers = [
  {
    id: "file://von-provider.mjs",
    label: "Local Von 1.3",
    prompts: ["bounded-state"],
  },
  ...(process.env.TYPESAFE_API_KEY ? [{
    id: "typesafe:jev-1.13.0",
    label: "TypeSafe Jev 1.13",
    prompts: ["bounded-state"],
    config: {
      questions: {
        assertion_kind: {
          type: "choice",
          instructions: "Choose one ontology bucket. Explicit first-person capability is skill_evidence. Do not infer personal facts from questions or commands.",
          criteria: KIND_CRITERIA,
        },
        profile_field: {
          type: "choice",
          instructions: "If this is a profile update, choose its field; otherwise choose none.",
          criteria: PROFILE_CRITERIA,
        },
      },
    },
  }] : []),
  {
    id: "file://clef-provider.mjs",
    label: `Local Clef ${process.env.CLEF_MODEL || "Cloudflare/clef-flash"}`,
    prompts: ["bounded-state"],
  },
];

const derivedMetrics = [
  { name: "accuracy", value: "kind_accuracy / __count" },
  { name: "coverage_rate", value: "coverage / __count" },
  { name: "safe_acceptance_rate", value: "safe_acceptance / __count" },
  { name: "false_durable_rate", value: "false_durable_candidates / __count" },
  { name: "probability_coverage", value: "probability_count / __count" },
  { name: "multiclass_brier", value: "brier_sum / (probability_count + 0.000001)" },
  ...ASSERTION_KINDS.flatMap((kind) => [
    { name: `precision_${kind}`, value: `tp_${kind} / (tp_${kind} + fp_${kind} + 0.000001)` },
    { name: `recall_${kind}`, value: `tp_${kind} / (tp_${kind} + fn_${kind} + 0.000001)` },
    { name: `f1_${kind}`, value: `2 * tp_${kind} / (2 * tp_${kind} + fp_${kind} + fn_${kind} + 0.000001)` },
  ]),
];

export default {
  description: "Compare private digital-twin transcript classifiers on 200 claim-level gold examples",
  prompts: [{ id: '{{transcript}}', label: "bounded-state" }],
  providers,
  tests,
  derivedMetrics,
  evaluateOptions: { maxConcurrency: 4, cache: true, timeoutMs: 30_000 },
  sharing: false,
  metadata: { dataClassification: "synthetic-no-personal-data", datasetVersion: dataset.version },
};
