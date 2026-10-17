import { readFileSync } from "node:fs";

import { KIND_CRITERIA, PROFILE_CRITERIA } from "../../dist/digital-twin/runtime/ingestion.js";
import { createSeleneJudgeAssertion } from "./judge-config.mjs";

const corpus = JSON.parse(readFileSync(new URL("./digital-twin-classifier.gold.json", import.meta.url), "utf8"));
const labelFile = JSON.parse(readFileSync(new URL("./digital-twin-judge.labels.json", import.meta.url), "utf8"));
const selectedIds = new Set([
  "topic-ddd", "topic-knowledge-graphs", "topic-testing", "topic-observability", "topic-voice",
  "skill-playwright", "skill-typescript", "skill-python", "skill-observability", "skill-containers",
  "profile-title", "profile-title-change", "profile-location", "profile-location-change", "profile-credential-degree",
  "none-question", "none-command", "none-hypothetical-title", "none-hypothetical-location", "none-negated-skill",
]);
const holdoutIds = new Set([
  "topic-voice", "skill-containers", "profile-credential-degree", "none-negated-skill",
]);
const wrongKind = {
  conversation_topic: "skill_evidence",
  skill_evidence: "conversation_topic",
  profile_update: "none",
  none: "profile_update",
};

const prediction = (kind, profileField = "none") => JSON.stringify({
  assertion_kind: { choice: kind, confidence: 0.95 },
  profile_field: { choice: profileField, confidence: 0.95 },
});

const tests = corpus.cases
  .filter((testCase) => selectedIds.has(testCase.id))
  .flatMap((testCase) => {
    const expectedProfileField = testCase.expectedProfileField || "none";
    const candidates = [
      {
        suffix: "supported",
        transcript: testCase.transcripts[0],
        candidate: prediction(testCase.expectedKind, expectedProfileField),
        proposedVerdict: "correct",
      },
      {
        suffix: "unsupported",
        transcript: testCase.transcripts[1],
        candidate: prediction(
          wrongKind[testCase.expectedKind],
          testCase.expectedKind === "none" ? "job_title" : "none",
        ),
        proposedVerdict: "incorrect",
      },
    ];
    return candidates.map((candidate) => {
      const id = `${testCase.id}#${candidate.suffix}`;
      return {
        description: id,
        vars: { transcript: candidate.transcript, candidate: candidate.candidate },
        metadata: {
          goldCase: testCase.id,
          split: holdoutIds.has(testCase.id) ? "holdout" : "development",
          humanVerdict: labelFile.labels[id] || "unreviewed",
          proposedVerdict: candidate.proposedVerdict,
          labelProvenance: labelFile.labels[id] ? "human" : "unreviewed",
        },
        assert: [createSeleneJudgeAssertion({
          kindCriteria: KIND_CRITERIA,
          profileCriteria: PROFILE_CRITERIA,
        })],
      };
    });
  });

export default {
  description: "Calibrate the local Selene judge against grouped human verdicts",
  prompts: ["{{candidate}}"],
  providers: ["echo"],
  tests,
  evaluateOptions: { maxConcurrency: 1, cache: true, timeoutMs: 30_000 },
  sharing: false,
  metadata: {
    dataClassification: "synthetic-no-personal-data",
    datasetVersion: corpus.version,
    labelVersion: labelFile.version,
  },
};
