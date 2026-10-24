import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { APP_RESOURCE_URI, configuredJournalGateway, createServer } from "../dist/server.js";

test("renders and reviews a journal suggestion through the MCP contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "journal-review-mcp-"));
  try {
    const appHtml = join(root, "main.html");
    await writeFile(appHtml, "<!doctype html><title>Journal Review</title>");
    const server = createServer(appHtml);
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map(({ name }) => name).sort(),
      ["get_review_status", "navigate_review", "render_journal_review", "review_active", "submit_journal_correction"],
    );
    const fallback = await client.callTool({
      name: "render_journal_review",
      arguments: { reviewId: "review-local-001" },
    });
    assert.equal(fallback.structuredContent.presentation.progress.total, 1);

    const rendered = await client.callTool({
      name: "render_journal_review",
      arguments: {
        reviewId: "review-local-001",
        items: [
          {
            id: "suggestion-001",
            transcript: "First note from the transcript.",
            source: "Voice session · first",
            type: "decision",
            statement: "First note from the transcript.",
            topics: ["review"],
            confidence: 0.9,
            evidence: { quote: "First note from the transcript.", start: 0, end: 31 },
          },
          {
            id: "suggestion-002",
            transcript: "Second note from the transcript.",
            source: "Voice session · second",
            type: "learning",
            statement: "Second note from the transcript.",
            topics: ["review"],
            evidence: { quote: "Second note from the transcript.", start: 0, end: 32 },
          },
        ],
      },
    });
    const presentation = rendered.structuredContent.presentation;
    assert.deepEqual(
      JSON.parse(rendered.content[1].text.split(": ", 2)[1]),
      presentation,
    );
    assert.equal(presentation.kind, "journal-review");
    assert.equal(presentation.outcome, "pending");
    assert.equal(
      presentation.transcript.slice(
        presentation.suggestion.evidence.start,
        presentation.suggestion.evidence.end,
      ),
      presentation.suggestion.evidence.quote,
    );

    const reviewed = await client.callTool({
      name: "review_active",
      arguments: {
        reviewId: presentation.reviewId,
        suggestionId: presentation.suggestion.id,
        outcome: "accepted",
      },
    });
    assert.equal(reviewed.structuredContent.presentation.outcome, "pending");
    assert.equal(reviewed.structuredContent.presentation.progress.reviewed, 1);
    assert.equal(reviewed.structuredContent.presentation.suggestion.id, "suggestion-002");
    assert.equal(reviewed.structuredContent.presentation.progress.current, 2);
    assert.equal(Object.hasOwn(reviewed.structuredContent.presentation.suggestion, "confidence"), false);

    const previous = await client.callTool({
      name: "navigate_review",
      arguments: {
        reviewId: presentation.reviewId,
        suggestionId: "suggestion-002",
        direction: "previous",
      },
    });
    assert.equal(previous.structuredContent.presentation.suggestion.id, "suggestion-001");
    assert.equal(previous.structuredContent.presentation.outcome, "accepted");
    assert.equal(previous.structuredContent.presentation.progress.reviewed, 1);

    const next = await client.callTool({
      name: "navigate_review",
      arguments: {
        reviewId: presentation.reviewId,
        suggestionId: "suggestion-001",
        direction: "next",
      },
    });
    const completed = await client.callTool({
      name: "review_active",
      arguments: {
        reviewId: presentation.reviewId,
        suggestionId: next.structuredContent.presentation.suggestion.id,
        outcome: "accepted",
      },
    });
    assert.equal(completed.structuredContent.presentation.suggestion.id, "suggestion-002");
    assert.equal(completed.structuredContent.presentation.outcome, "accepted");
    assert.equal(completed.structuredContent.presentation.progress.current, 2);
    assert.equal(completed.structuredContent.presentation.progress.total, 2);
    assert.equal(completed.structuredContent.presentation.progress.reviewed, 2);

    const atEnd = await client.callTool({
      name: "navigate_review",
      arguments: {
        reviewId: presentation.reviewId,
        suggestionId: "suggestion-002",
        direction: "next",
      },
    });
    assert.equal(atEnd.structuredContent.presentation.suggestion.id, "suggestion-002");
    assert.equal(atEnd.structuredContent.presentation.outcome, "accepted");

    const status = await client.callTool({
      name: "get_review_status",
      arguments: { reviewId: presentation.reviewId },
    });
    assert.equal(status.structuredContent.outcome, "accepted");
    assert.equal(status.structuredContent.progress.reviewed, 2);

    const appResource = await client.readResource({ uri: APP_RESOURCE_URI });
    assert.match(appResource.contents[0].text, /Journal Review/u);

    await Promise.all([client.close(), server.close()]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("saves an exact-evidence correction through the gateway before marking it reviewed", async () => {
  const root = await mkdtemp(join(tmpdir(), "journal-correction-mcp-"));
  const entryId = `${"a".repeat(32)}:entry:1`;
  const calls = [];
  let rejectSave = true;
  try {
    const appHtml = join(root, "main.html");
    await writeFile(appHtml, "<!doctype html><title>Journal Review</title>");
    const server = createServer(appHtml, {
      async saveCorrection(id, correction) {
        calls.push({ id, correction });
        if (rejectSave) throw new Error("Gateway unavailable");
        return "feedback-001";
      },
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const rendered = await client.callTool({ name: "render_journal_review", arguments: {
      reviewId: "correction-test", items: [{ id: entryId, source: "Owner turn", transcript: "Keep source evidence.",
        type: "decision", statement: "Keep source evidence.", topics: ["source"],
        evidence: { quote: "source evidence", start: 5, end: 20 } }],
    } });
    assert.equal(rendered.structuredContent.presentation.canSaveCorrection, true);
    const argumentsFor = { reviewId: "correction-test", suggestionId: entryId,
      text: "Keep exact source evidence.", type: "decision", topics: ["source", "review"],
      evidence: { quote: "source evidence", start: 5, end: 20 } };
    const invalid = await client.callTool({ name: "submit_journal_correction", arguments: {
      ...argumentsFor, evidence: { quote: "wrong", start: 5, end: 20 },
    } });
    assert.equal(invalid.isError, true);
    assert.equal(calls.length, 0);
    const failed = await client.callTool({ name: "submit_journal_correction", arguments: argumentsFor });
    assert.equal(failed.isError, true);
    const pending = await client.callTool({ name: "get_review_status", arguments: { reviewId: "correction-test" } });
    assert.equal(pending.structuredContent.outcome, "pending");
    rejectSave = false;
    const saved = await client.callTool({ name: "submit_journal_correction", arguments: argumentsFor });
    assert.equal(saved.isError, undefined);
    assert.equal(saved.structuredContent.receipt.feedbackId, "feedback-001");
    assert.equal(saved.structuredContent.presentation.outcome, "edited");
    assert.equal(saved.structuredContent.presentation.suggestion.statement, argumentsFor.text);
    assert.deepEqual(calls.at(-1), { id: entryId, correction: { text: argumentsFor.text, type: "decision", topics: ["source", "review"] } });
    await Promise.all([client.close(), server.close()]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("gateway adapter sends an authenticated, bounded correction to the existing v1 route", async () => {
  const previous = {
    base: process.env.AGENT_GATEWAY_BASE_URL,
    token: process.env.AGENT_GATEWAY_TOKEN,
    identity: process.env.JOURNAL_REVIEW_OWNER_IDENTITY,
    fetch: globalThis.fetch,
  };
  const entryId = `${"b".repeat(32)}:entry:2`;
  try {
    process.env.AGENT_GATEWAY_BASE_URL = "http://gateway.test/v1";
    process.env.AGENT_GATEWAY_TOKEN = "test-token";
    process.env.JOURNAL_REVIEW_OWNER_IDENTITY = "owner@example.test";
    globalThis.fetch = async (url, options) => {
      assert.equal(url, `http://gateway.test/v1/digital-twin/journal/${encodeURIComponent(entryId)}/feedback`);
      assert.equal(options.headers.Authorization, "Bearer test-token");
      assert.deepEqual(JSON.parse(options.body), {
        identity: "owner@example.test", action: "edit", correctedText: "Corrected note",
        correctedType: "learning", correctedTopics: ["review"],
      });
      return new Response(JSON.stringify({ entryId, feedbackId: "receipt-123" }), { status: 200 });
    };
    const gateway = configuredJournalGateway();
    assert.ok(gateway);
    assert.equal(await gateway.saveCorrection(entryId, { text: "Corrected note", type: "learning", topics: ["review"] }), "receipt-123");
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of Object.entries({ AGENT_GATEWAY_BASE_URL: previous.base,
      AGENT_GATEWAY_TOKEN: previous.token, JOURNAL_REVIEW_OWNER_IDENTITY: previous.identity })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
