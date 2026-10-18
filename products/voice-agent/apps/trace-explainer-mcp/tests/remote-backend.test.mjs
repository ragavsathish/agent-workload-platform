import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { HttpTraceRenderBackend } from "../dist/artifacts.js";

test("remote render backend keeps worker manifests out of durable status", async () => {
  const renderId = "a".repeat(32);
  const traceId = "b".repeat(32);
  const narrationBrief = "Explain this trace for a backend reviewer.";
  const now = new Date().toISOString();
  const job = {
    renderId,
    traceId,
    narrationBriefSha256: createHash("sha256").update(narrationBrief).digest("hex"),
    status: "completed",
    createdAt: now,
    updatedAt: now,
  };
  const server = createServer(async (request, response) => {
    if (request.method === "POST") {
      const body = [];
      for await (const chunk of request) body.push(chunk);
      const form = await new Request("http://worker.test/submission", {
        method: "POST",
        headers: { "content-type": request.headers["content-type"] },
        body: Buffer.concat(body),
      }).formData();
      assert.equal(await form.get("trace").text(), "trace-bytes");
      assert.deepEqual(JSON.parse(form.get("metadata")), { traceId, narrationBrief });
      response.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify(job));
      return;
    }
    if (request.url?.endsWith("/video")) {
      response.writeHead(200, { "content-type": "video/mp4" }).end("video-bytes");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      ...job,
      manifest: { title: "Sandboxed render", scenes: [] },
    }));
  });
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  assert.equal(typeof address, "object");
  const root = await mkdtemp(join(tmpdir(), "trace-render-backend-"));
  try {
    const trace = join(root, "trace.zip");
    await writeFile(trace, "trace-bytes");
    const backend = new HttpTraceRenderBackend(`http://127.0.0.1:${address.port}`);
    assert.deepEqual(await backend.submit(renderId, traceId, trace, narrationBrief), job);
    assert.deepEqual(await backend.status(renderId), job);
    assert.deepEqual(await backend.manifest(renderId), {
      title: "Sandboxed render",
      scenes: [],
    });
    assert.equal(Buffer.from(await backend.video(renderId)).toString(), "video-bytes");
  } finally {
    await rm(root, { recursive: true, force: true });
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});
