import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const voiceRoot = resolve(appRoot, "../..");
const gatewayUrl = process.env.AGENT_GATEWAY_BASE_URL ?? "http://127.0.0.1:9444/v1";
const oxigraphUrl = process.env.OXIGRAPH_OPERATOR_URL ?? "http://127.0.0.1:7878";
const journalGraph = "urn:awp:digital-twin:graph:journal";
const feedbackGraph = "urn:awp:digital-twin:graph:journal-feedback";

async function operatorRequest(path, body, contentType, accept) {
  const response = await fetch(`${oxigraphUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": contentType, ...(accept ? { Accept: accept } : {}) },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.ok, true, `Oxigraph ${path} returned ${response.status}`);
  return response;
}

async function update(sparql) {
  await operatorRequest("/update", sparql, "application/sparql-update");
}

async function bindings(sparql) {
  const response = await operatorRequest("/query", sparql, "application/sparql-query", "application/sparql-results+json");
  return (await response.json()).results.bindings;
}

function identityFrom(envFile) {
  const line = envFile.split(/\r?\n/u).find((item) => item.startsWith("ORCHESTRATOR_ALLOWED_USERS="));
  const identity = line?.split("=", 2)[1]?.trim().replace(/^['"]|['"]$/gu, "").split(",", 1)[0];
  assert.ok(identity, "The deployment has no owner identity");
  return identity;
}

test("deployed MCP correction reaches the gateway and Oxigraph, then removes its fixture", async () => {
  const captureId = randomUUID().replaceAll("-", "");
  const entryId = `${captureId}:entry:1`;
  const capture = `urn:awp:digital-twin:journal:${captureId}`;
  const entry = `urn:awp:digital-twin:journal:${entryId}`;
  const original = "Allure round-trip fixture before review.";
  const corrected = "Allure round-trip fixture after review.";
  const owner = identityFrom(await readFile(resolve(voiceRoot, "deploy/.env"), "utf8"));
  const token = (await readFile(resolve(voiceRoot, "deploy/secrets/agent-gateway-token"), "utf8")).trim();
  let client;
  let feedbackId;
  try {
    await update(`PREFIX schema: <https://schema.org/>
INSERT DATA { GRAPH <${journalGraph}> {
  <${capture}> a schema:Message ; schema:identifier "allure-${captureId}" ; schema:text "${original}" .
  <${entry}> a schema:CreativeWork ; schema:identifier "${entryId}" ; schema:additionalType "idea" ;
    schema:text "${original}" ; schema:isBasedOn <${capture}> ; schema:keywords "Allure fixture" .
} }`);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve(appRoot, "dist/main.js"), "--stdio"],
      cwd: appRoot,
      env: {
        ...process.env,
        AGENT_GATEWAY_BASE_URL: gatewayUrl,
        AGENT_GATEWAY_TOKEN: token,
        JOURNAL_REVIEW_OWNER_IDENTITY: owner,
      },
      stderr: "pipe",
    });
    client = new Client({ name: "allure-deployed-roundtrip", version: "1.0.0" });
    await client.connect(transport);
    const reviewId = `allure-${captureId}`;
    const rendered = await client.callTool({ name: "render_journal_review", arguments: {
      reviewId,
      items: [{ id: entryId, source: "Allure fixture", transcript: original,
        type: "idea", statement: original, topics: ["Allure fixture"],
        evidence: { quote: original, start: 0, end: original.length } }],
    } });
    assert.equal(rendered.isError, undefined);
    assert.equal(rendered.structuredContent.presentation.canSaveCorrection, true);

    const saved = await client.callTool({ name: "submit_journal_correction", arguments: {
      reviewId, suggestionId: entryId, text: corrected, type: "learning",
      topics: ["Allure verified"], evidence: { quote: original, start: 0, end: original.length },
    } });
    assert.equal(saved.isError, undefined, saved.content?.[0]?.text);
    feedbackId = saved.structuredContent.receipt.feedbackId;
    assert.match(feedbackId, /^[a-f0-9]{32}$/u);
    assert.equal(saved.structuredContent.presentation.outcome, "edited");

    const rows = await bindings(`PREFIX schema: <https://schema.org/>
PREFIX awp: <urn:awp:digital-twin:predicate:>
SELECT ?text ?type ?topic ?status ?action WHERE {
  GRAPH <${journalGraph}> { <${entry}> schema:text ?text ; schema:additionalType ?type ; schema:keywords ?topic ; awp:status ?status . }
  GRAPH <${feedbackGraph}> { <urn:awp:digital-twin:journal-feedback:${feedbackId}> schema:actionStatus ?action ; schema:isBasedOn <${entry}> . }
}`);
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.fromEntries(Object.entries(rows[0]).map(([key, value]) => [key, value.value])), {
      text: corrected, type: "learning", topic: "Allure verified", status: "reviewed", action: "edit",
    });
  } finally {
    try {
      await client?.close();
    } finally {
      await update(`DELETE WHERE { GRAPH <${journalGraph}> { <${entry}> ?p ?o } };
DELETE WHERE { GRAPH <${journalGraph}> { <${capture}> ?p ?o } };
DELETE WHERE { GRAPH <${feedbackGraph}> { ?event <https://schema.org/isBasedOn> <${entry}> ; ?p ?o } }`);
      const remaining = await bindings(`SELECT ?value WHERE {
  { GRAPH <${journalGraph}> { <${entry}> ?p ?value } }
  UNION { GRAPH <${journalGraph}> { <${capture}> ?p ?value } }
  UNION { GRAPH <${feedbackGraph}> { ?value <https://schema.org/isBasedOn> <${entry}> } }
} LIMIT 1`);
      assert.equal(remaining.length, 0, "The round-trip fixture was not fully removed");
    }
  }
});
