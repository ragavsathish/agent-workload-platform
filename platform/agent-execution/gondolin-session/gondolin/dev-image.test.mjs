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
const preloadImporter = fs.readFileSync(new URL("./import-compose-cache.clj", import.meta.url), "utf8");
const composeLoader = fs.readFileSync(new URL("./dev-compose", import.meta.url), "utf8");
const piExtension = fs.readFileSync(new URL("../pi-extension.ts", import.meta.url), "utf8");
const builderDockerfile = fs.readFileSync(new URL("../image-builder/Dockerfile", import.meta.url), "utf8");
const builderManager = fs.readFileSync(new URL("../image-builder/manager.ts", import.meta.url), "utf8");
const cacheWorkflow = fs.readFileSync(new URL("../../../../.gitea/workflows/prepare-compose-image-cache.yml", import.meta.url), "utf8");

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
  assert.match(preloadBuilder, /\.tar"/);
  assert.match(preloadBuilder, /"sha256"/);
  assert.match(composeLoader, /image_store=\/image-store\/agent\/images/);
  assert.match(composeLoader, /\$image_store\/\$archive/);
  assert.match(composeLoader, /sha256sum --check/);
  assert.match(composeLoader, /GONDOLIN_DEV_IMAGE_STORE/);
  assert.match(composeLoader, /docker load --input "\$archive_path"/);
  assert.doesNotMatch(composeLoader, /zstd/);
  assert.match(piExtension, /"\/image-store"/);
  assert.doesNotMatch(dockerfile, /zstd/);
  assert.match(stackHook, /gondolin-preload:/);
});

test("Gitea cache workflow writes a checksummed handoff for host promotion", () => {
  assert.match(cacheWorkflow, /workflow_dispatch:/);
  assert.match(cacheWorkflow, /runs-on: gondolin-builder/);
  assert.match(cacheWorkflow, /http:\/\/compose-cache\.local:18080\/v1/);
  assert.match(cacheWorkflow, /\/prepare/);
  assert.match(cacheWorkflow, /COMPOSE_CACHE_HOST_TOKEN/);
  assert.match(builderManager, /gondolin-compose-cache-handoff/);
  assert.match(builderManager, /class ComposeCacheHostService/);
  assert.match(builderManager, /\["pull", service\.image\]/);
  assert.match(builderManager, /\["save", "--output"/);
  assert.match(builderDockerfile, /docker\/compose\/releases\/download/);
  assert.doesNotMatch(builderDockerfile, /babashka\/babashka\/releases\/download/);
  assert.match(preloadImporter, /sha256-file/);
  assert.match(preloadImporter, /Import.*shared image archives/);
});
