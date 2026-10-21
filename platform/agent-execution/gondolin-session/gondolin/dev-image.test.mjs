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
const stackHook = fs.readFileSync(new URL("../../../../.pi/hooks/start-dev-stack.clj", import.meta.url), "utf8");
const preloadBuilder = fs.readFileSync(new URL("./prepare-compose-cache.clj", import.meta.url), "utf8");
const composeLoader = fs.readFileSync(new URL("./dev-compose", import.meta.url), "utf8");
const piExtension = fs.readFileSync(new URL("../pi-extension.ts", import.meta.url), "utf8");

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

test("development image pins Babashka for the Clojure session-start hook", () => {
  assert.match(dockerfile, /^ARG BABASHKA_VERSION=\d+\.\d+\.\d+$/m);
  assert.match(dockerfile, /babashka-\$\{BABASHKA_VERSION\}-linux-\$\{bb_arch\}-static\.tar\.gz/);
  assert.match(dockerfile, /sha256sum --check/);
  assert.match(dockerfile, /tar -xzf \/tmp\/babashka\.tar\.gz -C \/usr\/local\/bin bb/);
  assert.equal(projectConfig.development.sessionStartHook, ".pi/hooks/start-dev-stack.clj");
  assert.match(stackHook, /\(ns start-dev-stack/);
  assert.match(dockerfile, /COPY select-compose-images\.clj \/usr\/local\/libexec\/select-compose-images\.clj/);
  assert.match(fs.readFileSync(new URL("./dev-compose", import.meta.url), "utf8"),
    /bb \/usr\/local\/libexec\/select-compose-images\.clj/);
});

test("Compose image preloads use the K3s agent/images folder convention", () => {
  assert.match(preloadBuilder, /\.resolve \(\.resolve preload-root "agent"\) "images"/);
  assert.match(preloadBuilder, /gondolin-preload:/);
  assert.match(preloadBuilder, /\.tar\.zst/);
  assert.match(preloadBuilder, /"sha256"/);
  assert.match(composeLoader, /image_store=\/image-store\/agent\/images/);
  assert.match(composeLoader, /\$image_store\/\$archive/);
  assert.match(composeLoader, /sha256sum --check/);
  assert.match(composeLoader, /zstd --quiet --decompress --stdout/);
  assert.match(composeLoader, /GONDOLIN_DEV_IMAGE_STORE/);
  assert.match(piExtension, /"\/image-store"/);
  assert.match(dockerfile, /zip zstd/);
  assert.match(stackHook, /gondolin-preload:/);
});
