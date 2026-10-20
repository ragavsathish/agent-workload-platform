import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const dockerfile = fs.readFileSync(new URL("./Dockerfile.dev", import.meta.url), "utf8");
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
