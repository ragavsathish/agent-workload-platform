import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyTranscript,
  extractTranscriptCandidates,
  identifyExplicitSkills,
  planTranscriptIngestion,
} from "../../dist/digital-twin/runtime/ingestion.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Von receives explicit ontology-oriented choices", async () => {
  let request;
  const decision = await classifyTranscript("I use Playwright for browser testing.", {
    fetch: async (url, init) => {
      request = { url, body: JSON.parse(init.body) };
      return jsonResponse({
        model: "von-1.3.0",
        answers: {
          assertion_kind: {
            type: "choice",
            choice: "skill_evidence",
            confidence: 0.93,
            probabilities: { skill_evidence: 0.93, conversation_topic: 0.04, profile_update: 0.01, none: 0.02 },
          },
          profile_field: {
            type: "choice",
            choice: "none",
            confidence: 0.91,
            probabilities: { job_title: 0.01, home_location: 0.01, credential: 0.01, employment: 0.01, none: 0.95 },
          },
        },
      });
    },
  });

  assert.equal(request.url, "http://127.0.0.1:8000/v1/systemone");
  assert.deepEqual(Object.keys(request.body.questions.assertion_kind.criteria), [
    "conversation_topic",
    "skill_evidence",
    "profile_update",
    "none",
  ]);
  assert.equal(decision.kind, "skill_evidence");
  assert.equal(decision.review, false);
});

test("low-confidence decisions stop before generative extraction", async () => {
  let calls = 0;
  const result = await planTranscriptIngestion("Maybe I could be an architect.", {
    fetch: async () => {
      calls += 1;
      return jsonResponse({
        model: "von-1.3.0",
        answers: {
          assertion_kind: {
            type: "choice",
            choice: "profile_update",
            confidence: 0.61,
            probabilities: { profile_update: 0.61, none: 0.39 },
          },
          profile_field: {
            type: "choice",
            choice: "job_title",
            confidence: 0.58,
            probabilities: { job_title: 0.58, none: 0.42 },
          },
        },
      });
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.review, true);
  assert.deepEqual(result.candidates, []);
});

test("Qwen extraction is schema constrained and evidence grounded", async () => {
  let request;
  const result = await extractTranscriptCandidates(
    "I use Playwright for browser testing.",
    { kind: "skill_evidence", profileField: "none" },
    {
      fetch: async (url, init) => {
        request = { url, body: JSON.parse(init.body) };
        return jsonResponse({
          message: {
            role: "assistant",
            content: JSON.stringify({
              candidates: [{ label: "Playwright", evidence_quote: "I use Playwright for browser testing." }],
            }),
          },
        });
      },
    },
  );

  assert.equal(request.url, "http://127.0.0.1:11434/api/chat");
  assert.equal(request.body.stream, false);
  assert.equal(request.body.options.temperature, 0);
  assert.equal(request.body.format.type, "object");
  assert.deepEqual(result.candidates.map((candidate) => candidate.label), ["Playwright"]);
});

test("Qwen evidence must occur verbatim in the transcript", async () => {
  await assert.rejects(
    extractTranscriptCandidates(
      "I am exploring RDF.",
      { kind: "conversation_topic", profileField: "none" },
      {
        fetch: async () => jsonResponse({
          message: {
            role: "assistant",
            content: JSON.stringify({
              candidates: [{ label: "RDF", evidence_quote: "I am an RDF expert." }],
            }),
          },
        }),
      },
    ),
    /evidence that is not present/,
  );
});

test("explicit skill identification returns reviewable skills with verbatim evidence", async () => {
  let request;
  const skills = await identifyExplicitSkills(
    "I use TypeScript and Playwright for browser testing.",
    {
      fetch: async (url, init) => {
        request = { url, body: JSON.parse(init.body) };
        return jsonResponse({
          message: {
            role: "assistant",
            content: JSON.stringify({
              candidates: [
                {
                  label: "TypeScript",
                  evidence_quote: "I use TypeScript and Playwright for browser testing.",
                },
                {
                  label: "Playwright",
                  evidence_quote: "I use TypeScript and Playwright for browser testing.",
                },
              ],
            }),
          },
        });
      },
    },
  );

  assert.equal(request.url, "http://127.0.0.1:11434/api/chat");
  assert.match(request.body.messages[0].content, /explicitly says they use, know, or can perform/);
  assert.deepEqual(skills, [
    {
      skill: "TypeScript",
      evidenceQuote: "I use TypeScript and Playwright for browser testing.",
    },
    {
      skill: "Playwright",
      evidenceQuote: "I use TypeScript and Playwright for browser testing.",
    },
  ]);
});

test("explicit skill identification discards malformed evidence without losing valid candidates", async () => {
  const skills = await identifyExplicitSkills("I use TypeScript and Playwright for browser testing.", {
      fetch: async () => jsonResponse({
        message: {
          role: "assistant",
          content: JSON.stringify({
            candidates: [
              { label: "TypeScript", evidence_quote: "I use TypeScript" },
              { label: "Playwright", evidence_quote: "I use ... Playwright for browser testing" },
            ],
          }),
        },
      }),
  });

  assert.deepEqual(skills, [{ skill: "TypeScript", evidenceQuote: "I use TypeScript" }]);
});
