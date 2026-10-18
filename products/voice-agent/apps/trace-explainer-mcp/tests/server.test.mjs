import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { strToU8, zipSync } from "fflate";

import { TraceArtifactStore } from "../dist/artifacts.js";
import { APP_RESOURCE_URI, createServer } from "../dist/server.js";

test("searches traces, renders the selected official viewer, and keeps video export separate", async () => {
  const root = await mkdtemp(join(tmpdir(), "trace-explainer-mcp-"));
  try {
    const artifacts = join(root, "artifacts");
    const traceDirectory = join(artifacts, "run-1");
    const output = join(root, "output");
    const appHtml = join(root, "main.html");
    await mkdir(traceDirectory, { recursive: true });
    const traceArchive = zipSync({
      "trace.trace": strToU8([
        JSON.stringify({ type: "before", callId: "call@1", startTime: 10, class: "Frame", method: "goto", params: { url: "http://gitea.local/repo" } }),
        JSON.stringify({ type: "after", callId: "call@1", endTime: 42 }),
        JSON.stringify({ type: "screencast-frame", sha1: "page@1.jpeg" }),
      ].join("\n")),
      "trace.network": strToU8(JSON.stringify({ type: "resource-snapshot" })),
      "resources/page@1.jpeg": strToU8("jpeg-fixture"),
    });
    await writeFile(join(traceDirectory, "trace.zip"), traceArchive);
    await writeFile(appHtml, "<!doctype html><title>Trace Explainer</title>");

    const store = new TraceArtifactStore(artifacts, output, async (_trace, destination) => {
      await mkdir(destination, { recursive: true });
      await writeFile(join(destination, "trace-explainer.mp4"), "video-bytes");
      await writeFile(join(destination, "manifest.json"), JSON.stringify({
        kind: "trace-explainer",
        title: "Fixture journey",
        summary: "One evidence-backed scene",
        outputDurationSeconds: 4.5,
        scenes: [{
          id: "scene-1",
          title: "Open dashboard",
          spoken: "The test opens the dashboard.",
          durationSeconds: 4.5,
          evidence: { pageId: "page@1", eventIds: ["call@1"] },
          audio: "must-not-leak.pcm",
        }],
      }));
    });
    const server = createServer(store, appHtml);
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map(({ name }) => name).sort(),
      [
        "get_trace_explainer",
        "render_narrated_trace_export",
        "render_playwright_trace",
        "search_playwright_traces",
      ],
    );
    const listed = await client.callTool({
      name: "search_playwright_traces",
      arguments: { query: "run 1", limit: 5 },
    });
    assert.equal(listed.structuredContent.recordings[0].name, "run 1");
    const traceId = listed.structuredContent.recordings[0].id;
    assert.match(traceId, /^[a-f0-9]{32}$/u);

    const viewer = await client.callTool({
      name: "render_playwright_trace",
      arguments: { traceId },
    });
    assert.equal(viewer.isError, undefined);
    assert.equal(viewer.structuredContent.presentation.kind, "playwright-trace-viewer");
    assert.match(viewer.structuredContent.presentation.viewerUrl, /\/trace-viewer\/index\.html\?trace=/u);
    assert.match(viewer.structuredContent.presentation.previewUrl, /\/preview$/u);
    assert.equal(viewer.structuredContent.presentation.actionCount, 1);
    assert.equal(viewer.structuredContent.presentation.requestCount, 1);
    assert.equal(viewer.structuredContent.presentation.actions[0].durationMs, 32);
    const modelVisiblePresentation = JSON.parse(viewer.content[0].text.split("\n").at(-1));
    assert.deepEqual(modelVisiblePresentation, viewer.structuredContent.presentation);
    const traceResourceLink = viewer.content.find(({ type }) => type === "resource_link");
    assert.equal(traceResourceLink.mimeType, "application/zip");
    const traceResource = await client.readResource({ uri: traceResourceLink.uri });
    assert.deepEqual(Buffer.from(traceResource.contents[0].blob, "base64"), Buffer.from(traceArchive));

    const rendered = await client.callTool({
      name: "render_narrated_trace_export",
      arguments: { traceId },
    });
    assert.equal(rendered.isError, undefined);
    assert.equal(rendered.structuredContent.render.status, "pending");
    const renderId = rendered.structuredContent.render.renderId;
    let completed;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      completed = await client.callTool({
        name: "get_trace_explainer",
        arguments: { renderId },
      });
      if (completed.structuredContent.presentation) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(completed.structuredContent.presentation.kind, "playwright-trace-viewer");
    assert.equal(completed.structuredContent.presentation.title, "run 1");
    assert.match(
      completed.structuredContent.presentation.narratedVideoUrl,
      /^http:\/\/127\.0\.0\.1:9450\/api\/trace-explainers\/[a-f0-9]{32}\/video$/u,
    );
    assert.equal(completed.structuredContent.presentation.narratedSceneCount, 1);
    assert.equal(completed.structuredContent.presentation.scenes, undefined);
    const resourceLink = completed.content.find(({ type }) => type === "resource_link");
    assert.equal(resourceLink.mimeType, "video/mp4");

    const appResource = await client.readResource({ uri: APP_RESOURCE_URI });
    assert.match(appResource.contents[0].text, /Trace Explainer/u);
    const videoResource = await client.readResource({ uri: resourceLink.uri });
    assert.equal(
      Buffer.from(videoResource.contents[0].blob, "base64").toString(),
      "video-bytes",
    );

    await Promise.all([client.close(), server.close()]);
    assert.deepEqual(await readFile(join(traceDirectory, "trace.zip")), Buffer.from(traceArchive));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
