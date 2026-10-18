import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { APP_RESOURCE_URI, createServer } from "../dist/server.js";

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
      ["get_review_status", "render_journal_review", "review_active"],
    );
    const rendered = await client.callTool({
      name: "render_journal_review",
      arguments: { reviewId: "review-local-001" },
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
    assert.equal(reviewed.structuredContent.presentation.outcome, "accepted");
    assert.equal(reviewed.structuredContent.presentation.progress.reviewed, 1);

    const status = await client.callTool({
      name: "get_review_status",
      arguments: { reviewId: presentation.reviewId },
    });
    assert.equal(status.structuredContent.outcome, "accepted");
    assert.equal(status.structuredContent.progress.reviewed, 1);

    const appResource = await client.readResource({ uri: APP_RESOURCE_URI });
    assert.match(appResource.contents[0].text, /Journal Review/u);

    await Promise.all([client.close(), server.close()]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
