import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";

const processor = fileURLToPath(new URL("../runtime/image/processor.mjs", import.meta.url));

async function fixtureServer(classifierConfidence = 0.93) {
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
      const content = system.includes("cognitive journal")
        ? { entries: [{ type: "learning", text: "Uses Playwright.", topics: ["testing"] }] }
        : { candidates: [{ label: "Playwright", evidence_quote: "I use Playwright." }] };
      response.end(JSON.stringify({ message: { content: JSON.stringify(content) } }));
    } else if (request.url === "/v1/digital-twin/journal") {
      response.end(JSON.stringify({ captureId: parsed.id, entries: parsed.entries.length }));
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

async function runProcessor(baseUrl, mode) {
  const child = spawn(process.execPath, [processor], {
    env: {
      ...process.env,
      DIGITAL_TWIN_MODEL_BASE_URL: baseUrl,
      DIGITAL_TWIN_MODEL: "qwen-test",
      DIGITAL_TWIN_CLASSIFIER_BASE_URL: baseUrl,
      DIGITAL_TWIN_CLASSIFIER_MODEL: "clef-test",
      DIGITAL_TWIN_REVIEW_THRESHOLD: "0.82",
      DIGITAL_TWIN_WRITER_URL: `${baseUrl}/v1/digital-twin/journal`,
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
    transcript: "I use Playwright.",
    capturedAt: "2026-10-17T10:00:00Z",
  }));
  const code = await new Promise((resolve) => child.once("close", resolve));
  assert.equal(code, 0, Buffer.concat(stderr).toString());
  return JSON.parse(Buffer.concat(stdout).toString());
}

test("journal job calls only Qwen and the fixed journal writer", async () => {
  const fixture = await fixtureServer();
  try {
    const result = await runProcessor(fixture.baseUrl, "journal");
    assert.equal(result.mode, "journal");
    assert.equal(result.entries, 1);
    assert.deepEqual(fixture.requests.map((request) => request.path), [
      "/api/chat", "/v1/digital-twin/journal",
    ]);
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
