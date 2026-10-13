import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GondolinPlaywrightMcp } from "./dist/client.js";

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const architecture = os.arch() === "arm64" ? "aarch64" : os.arch() === "x64" ? "x86_64" : "unsupported";
const imagePath = path.resolve(
  process.env.GONDOLIN_BROWSER_ASSETS
    ?? path.join(runtimeDir, "..", "..", "artifacts", "gondolin-browser", architecture),
);
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "gondolin-agent-workspace-"));
const hostOnly = fs.mkdtempSync(path.join(os.tmpdir(), "gondolin-agent-host-only-"));
fs.writeFileSync(path.join(workspace, "visible.txt"), "workspace-visible\n");
fs.writeFileSync(path.join(hostOnly, "secret.txt"), "host-secret\n");

const agent = new GondolinPlaywrightMcp({
  imagePath,
  mounts: { "/workspace": workspace },
  allowedHosts: [],
  sessionLabel: "gondolin-agent-smoke",
});

try {
  const [result, inodeResult] = await Promise.all([
    agent.exec("pwd; cat visible.txt; printf 'created-in-vm\\n' > created.txt; df -h /workspace"),
    agent.exec("df -i /workspace"),
  ]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(inodeResult.exitCode, 0, inodeResult.stderr);
  assert.match(result.stdout, /^\/workspace$/m);
  assert.match(result.stdout, /^workspace-visible$/m);
  assert.match(result.stdout, /Filesystem/);
  assert.match(inodeResult.stdout, /Inodes/);
  assert.equal(fs.readFileSync(path.join(workspace, "created.txt"), "utf8"), "created-in-vm\n");

  const escaped = await agent.exec(`cat ${JSON.stringify(path.join(hostOnly, "secret.txt"))}`);
  assert.notEqual(escaped.exitCode, 0);
  assert.doesNotMatch(escaped.stdout, /host-secret/);
  assert.doesNotMatch(escaped.stderr, /host-secret/);
  console.log("Gondolin agent: workspace shell passed; unmounted host path blocked");
} finally {
  await agent.close();
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(hostOnly, { recursive: true, force: true });
}
