import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";

const processor = fileURLToPath(new URL("../runtime/image/processor.mjs", import.meta.url));

async function fixtureServer(classifierConfidence = 0.93, journalEntries, dailyJournal = {
  title: "The work found its shape",
  story: "I started with a broad idea and narrowed it to a concrete change. The useful part was seeing how the pieces fit together.\n\nBy the end, I had a clearer next step and a better sense of what mattered.",
}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const parsed = JSON.parse(body);
    requests.push({ path: request.url, body: parsed, authorization: request.headers.authorization });
    response.setHeader("content-type", "application/json");
    if (request.url === "/v1/systemone") {
      response.end(JSON.stringify({
        model: "clef-test",
        answers: {
          assertion_kind: {
            type: "choice", choice: "skill_evidence", confidence: classifierConfidence,
            probabilities: { skill_evidence: classifierConfidence, none: 1 - classifierConfidence },
          },
          profile_field: {
            type: "choice", choice: "none", confidence: 0.99,
            probabilities: { none: 0.99 },
          },
        },
      }));
    } else if (request.url === "/api/chat") {
      const system = parsed.messages[0].content;
      const content = system.includes("daily journal essay")
        ? dailyJournal
        : system.includes("cognitive journal")
        ? { entries: journalEntries ?? [{
          type: "idea",
          text: "Playwright could improve test reliability.",
          topics: ["testing"],
          evidenceQuote: "I think Playwright could improve test reliability.",
        }] }
        : { candidates: [{ label: "Playwright", evidence_quote: "I use Playwright." }] };
      response.end(JSON.stringify({ message: { content: JSON.stringify(content) } }));
    } else if (request.url === "/v1/digital-twin/journal") {
      response.end(JSON.stringify({ captureId: parsed.id, entries: parsed.entries.length }));
    } else if (request.url === "/v1/digital-twin/daily-journal") {
      response.end(JSON.stringify({ journalId: parsed.id, entries: 1 }));
    } else if (request.url === "/v1/digital-twin/reviews") {
      response.end(JSON.stringify({ captureId: parsed.id, candidates: parsed.candidates.length }));
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found" }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function runProcessor(
  baseUrl,
  mode,
  transcript = mode === "journal"
    ? "I think Playwright could improve test reliability."
    : "I use Playwright.",
  extra = {},
) {
  const child = spawn(process.execPath, [processor], {
    env: {
      ...process.env,
      DIGITAL_TWIN_MODEL_BASE_URL: baseUrl,
      DIGITAL_TWIN_MODEL: "qwen-test",
      DIGITAL_TWIN_CLASSIFIER_BASE_URL: baseUrl,
      DIGITAL_TWIN_CLASSIFIER_MODEL: "clef-test",
      DIGITAL_TWIN_REVIEW_THRESHOLD: "0.82",
      DIGITAL_TWIN_WRITER_URL: `${baseUrl}/v1/digital-twin/journal`,
      DIGITAL_TWIN_DAILY_JOURNAL_WRITER_URL: `${baseUrl}/v1/digital-twin/daily-journal`,
      DIGITAL_TWIN_REVIEW_WRITER_URL: `${baseUrl}/v1/digital-twin/reviews`,
      DIGITAL_TWIN_WRITER_TOKEN: "writer-secret",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.stdin.end(JSON.stringify({
    mode,
    identity: "owner@example.com",
    sessionId: "session-1",
    messageId: "message-1",
    transcript,
    capturedAt: "2026-10-17T10:00:00Z",
    ...extra,
  }));
  const code = await new Promise((resolve) => child.once("close", resolve));
  assert.equal(code, 0, Buffer.concat(stderr).toString());
  return JSON.parse(Buffer.concat(stdout).toString());
}

test("daily journal task writes one coherent prose page with source provenance", async () => {
  const fixture = await fixtureServer();
  try {
    const result = await runProcessor(fixture.baseUrl, "daily-journal", undefined, {
      taskId: "8e71e663-0fcb-4e5e-b4a3-d74c3b730000",
      journalDate: "2026-10-17",
      timeZone: "Europe/Helsinki",
      sources: [{
        sourceRef: "session-1:message-1",
        speaker: "owner",
        capturedAt: "2026-10-17T10:00:00+03:00",
        transcript: "I learned to keep evidence separate.",
      }],
    });
    assert.equal(result.mode, "daily-journal");
    assert.equal(result.sources, 1);
    assert.equal(result.storyCharacters > 100, true);
    const journal = fixture.requests.find((request) => request.path === "/v1/digital-twin/daily-journal");
    assert.equal(journal.authorization, "Bearer writer-secret");
    assert.equal(journal.body.taskId, "8e71e663-0fcb-4e5e-b4a3-d74c3b730000");
    assert.equal(journal.body.sources[0].speaker, "owner");
    assert.equal(journal.body.story, "I started with a broad idea and narrowed it to a concrete change. The useful part was seeing how the pieces fit together.\n\nBy the end, I had a clearer next step and a better sense of what mattered.");
    assert.equal(journal.body.reflections, undefined);
  } finally {
    await fixture.close();
  }
});

test("daily journal rejects an outline instead of writing it as a story", async () => {
  const fixture = await fixtureServer(0.93, undefined, {
    title: "A day of tasks",
    story: "- Fixed the tests\n- Updated the prompt\n- Prepared a release",
  });
  try {
    await assert.rejects(
      runProcessor(fixture.baseUrl, "daily-journal", undefined, {
        journalDate: "2026-10-17",
        timeZone: "Europe/Helsinki",
        sources: [{ sourceRef: "session-1:message-1", speaker: "owner", capturedAt: "2026-10-17T10:00:00+03:00", transcript: "I worked on the project." }],
      }),
      /daily journal story must be prose/,
    );
    assert.equal(fixture.requests.some((request) => request.path === "/v1/digital-twin/daily-journal"), false);
  } finally {
    await fixture.close();
  }
});

test("journal job calls only Qwen and the fixed journal writer", async () => {
  const fixture = await fixtureServer();
  try {
    const result = await runProcessor(fixture.baseUrl, "journal");
    assert.equal(result.mode, "journal");
    assert.equal(result.entries, 1);
    assert.deepEqual(result.decision, {
      extractorVersion: "journal-v4-sentence-gate",
      outcome: "written",
      inputSentences: 1,
      eligibleSentences: 1,
      modelInvoked: true,
      modelEntries: 1,
      groundedEntries: 1,
      rejectedEntries: 0,
    });
    assert.deepEqual(fixture.requests.map((request) => request.path), [
      "/api/chat", "/v1/digital-twin/journal",
    ]);
  } finally {
    await fixture.close();
  }
});

test("journal job does not persist authentication events", async () => {
  const fixture = await fixtureServer();
  try {
    const result = await runProcessor(
      fixture.baseUrl,
      "journal",
      "Authenticated user: owner@example.com",
    );
    assert.equal(result.entries, 0);
    assert.deepEqual(fixture.requests, []);
  } finally {
    await fixture.close();
  }
});

test("journal job rejects routine commands before model inference", async () => {
  const fixture = await fixtureServer();
  try {
    const result = await runProcessor(
      fixture.baseUrl,
      "journal",
      "Use speech synthesis for the narration.",
    );
    assert.equal(result.entries, 0);
    assert.equal(result.skipped, "low-value-transcript");
    assert.equal(result.decision.outcome, "filtered");
    assert.equal(result.decision.modelInvoked, false);
    assert.deepEqual(fixture.requests, []);
  } finally {
    await fixture.close();
  }
});

test("journal job removes status noise but keeps a meaningful sentence", async () => {
  const learning = "I learned that stable identifiers make retries idempotent.";
  const fixture = await fixtureServer(0.93, [{
    type: "learning",
    text: "Stable identifiers make retries idempotent.",
    topics: ["idempotency", "retries"],
    evidenceQuote: learning,
  }]);
  try {
    const result = await runProcessor(
      fixture.baseUrl,
      "journal",
      `System connected successfully. ${learning}`,
    );
    assert.equal(result.entries, 1);
    const modelRequest = fixture.requests.find((request) => request.path === "/api/chat");
    assert.equal(modelRequest.body.messages.at(-1).content, learning);
  } finally {
    await fixture.close();
  }
});

test("journal job persists only grounded, meaningful model entries", async () => {
  const fixture = await fixtureServer(0.93, [
    {
      type: "idea",
      text: "Use confidence training to improve reasoning models.",
      topics: ["confidence training", "reasoning models"],
      evidenceQuote: "confidence training could improve reasoning models",
    },
    {
      type: "learning",
      text: "The owner is affiliated with a university.",
      topics: ["education"],
      evidenceQuote: "confidence training",
    },
    {
      type: "thought",
      text: "The idea of it.",
      topics: ["idea"],
      evidenceQuote: "idea",
    },
    {
      type: "decision",
      text: "Use confidence training for reasoning models.",
      topics: ["confidence training"],
      evidenceQuote: "confidence training could improve reasoning models",
    },
  ]);
  try {
    const result = await runProcessor(
      fixture.baseUrl,
      "journal",
      "I think confidence training could improve reasoning models; that is my idea.",
    );
    assert.equal(result.entries, 1);
    const journalRequest = fixture.requests.find((request) => request.path === "/v1/digital-twin/journal");
    assert.deepEqual(journalRequest.body.entries, [{
      id: `${result.captureId}:entry:1`,
      type: "idea",
      text: "Use confidence training to improve reasoning models.",
      topics: ["confidence training", "reasoning models"],
    }]);
  } finally {
    await fixture.close();
  }
});

test("classifier job sends grounded Qwen candidates only to review", async () => {
  const fixture = await fixtureServer();
  try {
    const result = await runProcessor(fixture.baseUrl, "classify");
    assert.equal(result.mode, "classify");
    assert.equal(result.kind, "skill_evidence");
    assert.equal(result.candidates, 1);
    assert.deepEqual(fixture.requests.map((request) => request.path), [
      "/v1/systemone", "/api/chat", "/v1/digital-twin/reviews",
    ]);
    const review = fixture.requests.at(-1);
    assert.equal(review.authorization, "Bearer writer-secret");
    assert.equal(review.body.candidates[0].evidenceQuote, "I use Playwright.");
  } finally {
    await fixture.close();
  }
});

test("low-confidence classification stops before Qwen extraction", async () => {
  const fixture = await fixtureServer(0.4);
  try {
    const result = await runProcessor(fixture.baseUrl, "classify");
    assert.equal(result.lowConfidence, true);
    assert.equal(result.candidates, 0);
    assert.deepEqual(fixture.requests.map((request) => request.path), ["/v1/systemone"]);
  } finally {
    await fixture.close();
  }
});
