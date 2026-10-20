import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const dockerfile = fs.readFileSync(new URL("./Dockerfile.dev", import.meta.url), "utf8");
const dockerStartup = fs.readFileSync(new URL("./start-dev-docker.sh", import.meta.url), "utf8");
const projectConfig = JSON.parse(fs.readFileSync(
  new URL("../../../../.pi/gondolin.json", import.meta.url),
  "utf8",
));
const lock = JSON.parse(fs.readFileSync(
  new URL("../../../../products/voice-agent/apps/client/package-lock.json", import.meta.url),
  "utf8",
));

test("dev image Playwright version matches the client lockfile", () => {
  const pinned = dockerfile.match(/^ARG CLIENT_PLAYWRIGHT_VERSION=(\S+)$/m)?.[1];
  assert.ok(pinned, "Dockerfile.dev must pin CLIENT_PLAYWRIGHT_VERSION");
  assert.equal(pinned, lock.packages["node_modules/playwright"].version);
  assert.equal(pinned, lock.packages[""].devDependencies.playwright);
});

test("Docker development VMs use krun and require OverlayFS before starting overlay2", () => {
  assert.equal(projectConfig.development.docker, true);
  assert.equal(projectConfig.development.vmm, "krun");
  assert.match(dockerStartup, /grep -qw overlay \/proc\/filesystems/);
  assert.match(dockerStartup, /--storage-driver=overlay2/);
  assert.doesNotMatch(dockerStartup, /--storage-driver=vfs/);
  assert.match(dockerStartup, /ip link set dev lo up/);
  assert.match(dockerStartup, /ip address replace 127\.0\.0\.1\/8 dev lo/);
});
