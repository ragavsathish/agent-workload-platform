import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ComposeCacheHostService } from "../dist/image-builder/manager.js";

const token = "a".repeat(64);

test("host Compose cache preparation reuses Docker images and writes an importer handoff", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "compose-cache-host-"));
  const bin = path.join(root, "bin");
  const handoffDirectory = path.join(root, "handoff");
  fs.mkdirSync(bin);
  const calls = path.join(root, "docker-calls.log");
  const fakeDocker = path.join(bin, "docker");
  fs.writeFileSync(fakeDocker, `#!/bin/sh
printf '%s\\n' "$*" >> '${calls}'
if [ "$1" = image ] && [ "$2" = inspect ]; then
  printf '%s\\n' 'sha256:${"b".repeat(64)}'
  exit 0
fi
if [ "$1" = save ]; then
  while [ "$#" -gt 0 ]; do
    if [ "$1" = --output ]; then shift; printf '%s\\n' 'fake image archive' > "$1"; exit 0; fi
    shift
  done
fi
exit 0
`);
  fs.chmodSync(fakeDocker, 0o755);
  const originalPath = process.env.PATH;
  const originalDocker = process.env.GONDOLIN_HOST_DOCKER;
  process.env.PATH = `${bin}:${originalPath ?? ""}`;
  process.env.GONDOLIN_HOST_DOCKER = fakeDocker;
  try {
    const service = new ComposeCacheHostService(handoffDirectory, token);
    const body = {
      revision: "c".repeat(40),
      arch: process.arch === "arm64" ? "aarch64" : "x86_64",
      runId: "test-1",
      composeConfig: { services: {
        grafana: { image: `grafana/otel-lgtm:0.30.1@sha256:${"d".repeat(64)}` },
        metrics: { image: `grafana/otel-lgtm:0.30.1@sha256:${"d".repeat(64)}` },
        edge: { build: { context: "." }, image: "example/edge:test" },
      } },
    };
    const request = new Request("http://compose-cache.local:18080/v1/prepare", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal((await service.handle(request))?.status, 202);
    let state;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await service.handle(new Request(
        "http://compose-cache.local:18080/v1/status?runId=test-1",
        { headers: { Authorization: `Bearer ${token}` } },
      ));
      state = await response.json();
      if (state.status === "ready" || state.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(state.status, "ready", JSON.stringify(state));
    assert.equal(state.images, 1);
    assert.equal(state.services, 2);
    const handoff = state.handoff;
    const index = JSON.parse(fs.readFileSync(path.join(handoff, "index.json"), "utf8"));
    const override = JSON.parse(fs.readFileSync(path.join(handoff, "compose.override.json"), "utf8"));
    assert.deepEqual(Object.keys(index.services).sort(), ["grafana", "metrics"]);
    assert.deepEqual(Object.keys(override.services).sort(), ["grafana", "metrics"]);
    assert.equal(fs.readdirSync(path.join(handoff, "agent", "images")).length, 1);
    const dockerCalls = fs.readFileSync(calls, "utf8");
    assert.doesNotMatch(dockerCalls, /^pull /m);
    assert.equal((dockerCalls.match(/^save /gm) ?? []).length, 1);
  } finally {
    process.env.PATH = originalPath;
    if (originalDocker === undefined) delete process.env.GONDOLIN_HOST_DOCKER;
    else process.env.GONDOLIN_HOST_DOCKER = originalDocker;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("host Compose cache endpoint requires its manager token", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "compose-cache-auth-"));
  try {
    const service = new ComposeCacheHostService(root, token);
    const response = await service.handle(new Request("http://compose-cache.local:18080/v1/status?runId=missing"));
    assert.equal(response.status, 401);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
