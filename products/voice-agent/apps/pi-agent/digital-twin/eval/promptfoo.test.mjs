import assert from "node:assert/strict";
import test from "node:test";

import classifierAssertion from "./assert-classification.mjs";
import ClefProvider from "./clef-provider.mjs";
import calibrationConfig from "./judge-calibration.promptfooconfig.mjs";
import config from "./promptfooconfig.mjs";
import { summarizeJudgeResults } from "./summarize-judge-results.mjs";

const output = (kind, confidence = 0.95, profileField = "none", profileConfidence = 0.95) => JSON.stringify({
  assertion_kind: {
    choice: kind,
    confidence,
    probabilities: {
      conversation_topic: kind === "conversation_topic" ? 0.94 : 0.02,
      skill_evidence: kind === "skill_evidence" ? 0.94 : 0.02,
      profile_update: kind === "profile_update" ? 0.94 : 0.02,
      none: kind === "none" ? 0.94 : 0.02,
    },
  },
  profile_field: { choice: profileField, confidence: profileConfidence },
});

const context = (mode, expectedKind, extra = {}) => ({
  config: { mode, ...extra },
  vars: { expectedKind, expectedProfileField: "home_location" },
});

test("Promptfoo corpus contains 200 balanced claim-level examples", () => {
  assert.equal(config.tests.length, 200);
  const counts = Object.groupBy(config.tests, (item) => item.vars.expectedKind);
  for (const kind of ["conversation_topic", "skill_evidence", "profile_update", "none"]) {
    assert.equal(counts[kind].length, 50);
  }
});

test("Promptfoo compares production Von with local Clef and uses Selene only as judge", () => {
  assert.ok(config.providers.some((provider) => provider.label === "Local Von 1.3"));
  const clef = config.providers.find((provider) => provider.label === "Local Clef Cloudflare/clef-flash");
  assert.equal(clef.id, "file://clef-provider.mjs");
  assert.ok(config.tests.every((testCase) => testCase.assert.some((entry) => entry.metric === "selene_judge")));
  assert.ok(config.providers.every((provider) => !provider.label.includes("Selene")));
});

test("Selene uses Promptfoo-native rubric grading with anchored structured output", () => {
  const judge = config.tests[0].assert.find((entry) => entry.metric === "selene_judge");
  assert.equal(judge.type, "llm-rubric");
  assert.match(judge.provider.id, /openai:chat:selene-1-mini/i);
  assert.equal(judge.provider.config.response_format.type, "json_schema");
  assert.deepEqual(judge.provider.config.response_format.json_schema.schema.properties.score.enum, [0, 0.5, 1]);
  assert.match(judge.rubricPrompt, /untrusted data/i);
  assert.match(judge.rubricPrompt, /correct: pass=true and score=1/i);
});

test("judge calibration keeps paraphrase groups wholly within development or holdout", () => {
  assert.equal(calibrationConfig.tests.length, 40);
  const splitByGoldCase = Object.groupBy(calibrationConfig.tests, (item) => item.metadata.goldCase);
  assert.equal(Object.keys(splitByGoldCase).length, 20);
  for (const groupedCases of Object.values(splitByGoldCase)) {
    assert.equal(groupedCases.length, 2);
    assert.equal(new Set(groupedCases.map((item) => item.metadata.split)).size, 1);
  }
  assert.equal(calibrationConfig.tests.filter((item) => item.metadata.split === "development").length, 32);
  assert.equal(calibrationConfig.tests.filter((item) => item.metadata.split === "holdout").length, 8);
  assert.ok(calibrationConfig.tests.every((item) => item.metadata.humanVerdict === "unreviewed"));
});

test("judge reporting separates grader errors from semantic incorrect verdicts", () => {
  const component = (score, metadata = {}) => ({
    assertion: { metric: "selene_judge" }, score, reason: "test", metadata,
  });
  const row = (description, humanVerdict, judgeComponent) => ({
    testCase: { description },
    metadata: { goldCase: description, split: "development", humanVerdict },
    gradingResult: { componentResults: [judgeComponent] },
  });
  const summary = summarizeJudgeResults({ results: { results: [
    row("correct", "correct", component(1)),
    row("semantic-failure", "correct", component(0)),
    row("transport-failure", "incorrect", component(0, { graderError: true })),
  ] } });
  assert.equal(summary.overall.judged, 2);
  assert.equal(summary.overall.notJudged, 1);
  assert.equal(summary.overall.agreements, 1);
  assert.equal(summary.overall.agreementRate, 0.5);
  assert.equal(summary.rows[0].description, "transport-failure");
});

test("Clef adapter uses the local SystemOne contract and preserves probabilities", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      model: "Cloudflare/clef-flash",
      answers: {
        assertion_kind: {
          type: "choice",
          choice: "conversation_topic",
          confidence: 0.9,
          probabilities: {
            conversation_topic: 0.92,
            skill_evidence: 0.03,
            profile_update: 0.01,
            none: 0.04,
          },
        },
        profile_field: {
          type: "choice",
          choice: "none",
          confidence: 0.99,
          probabilities: {
            job_title: 0.0025,
            home_location: 0.0025,
            credential: 0.0025,
            employment: 0.0025,
            none: 0.99,
          },
        },
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await new ClefProvider().callApi("ignored", {
      vars: { transcript: "I want to learn DDD." },
    });
    assert.equal(requestBody.model, "Cloudflare/clef-flash");
    assert.equal(JSON.parse(result.output).assertion_kind.probabilities.conversation_topic, 0.92);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Promptfoo assertions distinguish accuracy, review, and false durable candidates", () => {
  assert.equal(classifierAssertion(
    output("skill_evidence"),
    context("accuracy", "skill_evidence"),
  ).score, 1);
  assert.equal(classifierAssertion(
    output("profile_update", 0.95, "job_title"),
    context("false_durable", "none"),
  ).score, 1);
  assert.equal(classifierAssertion(
    output("profile_update", 0.6, "job_title", 0.6),
    context("safe_acceptance", "none"),
  ).score, 1);
  assert.equal(classifierAssertion(
    output("profile_update", 0.95, "home_location"),
    context("profile_field", "profile_update"),
  ).score, 1);
});

test("Promptfoo assertions calculate multiclass counters and Brier score", () => {
  const actual = output("none");
  assert.equal(classifierAssertion(actual, context("tp", "none", { targetClass: "none" })).score, 1);
  assert.equal(classifierAssertion(actual, context("fp", "skill_evidence", { targetClass: "none" })).score, 1);
  assert.equal(classifierAssertion(actual, context("fn", "skill_evidence", { targetClass: "skill_evidence" })).score, 1);
  assert.ok(classifierAssertion(actual, context("brier", "none")).score < 0.01);
});
