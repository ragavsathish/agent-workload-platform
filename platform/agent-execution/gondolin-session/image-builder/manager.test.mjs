import assert from "node:assert/strict";
import test from "node:test";

import { createBuilderServiceAccess, DockerJobHostService } from "../dist/image-builder/manager.js";

const token = "a".repeat(64);
const apiToken = "b".repeat(64);

test("builder policy substitutes admin credential only for Gitea requests", async () => {
  const adminToken = "builder-admin-private-token";
  const service = createBuilderServiceAccess(
    "http://127.0.0.1:3001", "http://127.0.0.1:4318", undefined, adminToken,
  );
  const placeholder = service.env.GITEA_ADMIN_TOKEN;
  assert.ok(placeholder);
  assert.notEqual(placeholder, adminToken);

  const giteaRequest = await service.httpHooks.onRequest(new Request(
    "http://gitea.local:3001/api/v1/user",
    { headers: { Authorization: `token ${placeholder}` } },
  ));
  assert.equal(giteaRequest.url, "http://127.0.0.1:3001/api/v1/user");
  assert.equal(giteaRequest.headers.get("authorization"), `token ${adminToken}`);

  await assert.rejects(() => service.httpHooks.onRequest(new Request(
    "https://example.com/",
    { headers: { Authorization: `token ${placeholder}` } },
  )));
});

test("Compose cache host hook forwards prepare and status requests to the Go API", async () => {
  const calls = [];
  const service = new DockerJobHostService(token, "http://127.0.0.1:18081", apiToken, async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ status: "queued" }, { status: 202 });
  });
  const body = { revision: "c".repeat(40), arch: "aarch64", runId: "test-1", composeConfig: { services: { grafana: { image: "grafana/grafana:12.0" } } } };
  const response = await service.handle(new Request("http://compose-cache.local:18080/v1/prepare", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { status: "queued" });
  assert.equal(calls[0].url, "http://127.0.0.1:18081/v1/prepare");
  assert.equal(calls[0].init.headers.get("authorization"), `Bearer ${apiToken}`);
  assert.deepEqual(JSON.parse(await new Response(calls[0].init.body).text()), body);

  const status = await service.handle(new Request("http://compose-cache.local:18080/v1/status?runId=test-1", {
    headers: { Authorization: `Bearer ${token}` },
  }));
  assert.equal(status.status, 202);
  assert.equal(calls[1].url, "http://127.0.0.1:18081/v1/status?runId=test-1");
});

test("image build context upload streams through the authenticated host hook", async () => {
  const calls = [];
  const service = new DockerJobHostService(token, "http://127.0.0.1:18081", apiToken, async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ status: "queued" }, { status: 202 });
  });
  const bytes = Buffer.from("verified-context-tar");
  const response = await service.handle(new Request("http://compose-cache.local:18080/v1/jobs/123e4567-e89b-12d3-a456-426614174000/context", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-tar", "Content-Encoding": "gzip", "Content-Length": String(bytes.length) },
    body: bytes,
  }));
  assert.equal(response.status, 202);
  assert.equal(calls[0].url, "http://127.0.0.1:18081/v1/jobs/123e4567-e89b-12d3-a456-426614174000/context");
  assert.equal(calls[0].init.headers.get("authorization"), `Bearer ${apiToken}`);
  assert.equal(calls[0].init.headers.get("content-type"), "application/x-tar");
  assert.equal(calls[0].init.headers.get("content-encoding"), "gzip");
  assert.equal(await new Response(calls[0].init.body).text(), bytes.toString());
});

test("Compose cache host hook requires its VM token", async () => {
  let forwarded = false;
  const service = new DockerJobHostService(token, "http://127.0.0.1:18081", apiToken, async () => {
    forwarded = true;
    return Response.json({});
  });
  const response = await service.handle(new Request("http://compose-cache.local:18080/v1/status?runId=missing"));
  assert.equal(response.status, 401);
  assert.equal(forwarded, false);
});
