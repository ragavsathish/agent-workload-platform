import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
const preloadImporter = fs.readFileSync(new URL("../image-builder/compose_cache_import.go", import.meta.url), "utf8");
const composeLoader = fs.readFileSync(new URL("./dev-compose", import.meta.url), "utf8");
const piExtension = fs.readFileSync(new URL("../pi-extension.ts", import.meta.url), "utf8");
const builderDockerfile = fs.readFileSync(new URL("../image-builder/Dockerfile", import.meta.url), "utf8");
const builderManager = fs.readFileSync(new URL("../image-builder/manager.ts", import.meta.url), "utf8");
const builderWorkflow = fs.readFileSync(new URL("../image-builder/image_build_api.go", import.meta.url), "utf8");
const imageBuildWorkflow = fs.readFileSync(new URL("../../../../.gitea/workflows/build-execution-image.yml", import.meta.url), "utf8");
const builderInstaller = fs.readFileSync(new URL("../image-builder/installer.ts", import.meta.url), "utf8");
const dockerJobAPI = fs.readFileSync(new URL("../image-builder/docker_job_api.go", import.meta.url), "utf8");
const dockerJobAPIDockerfile = fs.readFileSync(new URL("../image-builder/Dockerfile.api", import.meta.url), "utf8");
const cacheWorkflow = fs.readFileSync(new URL("../../../../.gitea/workflows/prepare-compose-image-cache.yml", import.meta.url), "utf8");

test("dev image Playwright version matches the client lockfile", () => {
  const pinned = dockerfile.match(/^ARG CLIENT_PLAYWRIGHT_VERSION=(\S+)$/m)?.[1];
  assert.ok(pinned, "Dockerfile.dev must pin CLIENT_PLAYWRIGHT_VERSION");
  assert.equal(pinned, lock.packages["node_modules/playwright"].version);
  assert.equal(pinned, lock.packages[""].devDependencies.playwright);
});

test("development image pins Mermaid CLI and the repository vendor revisions", () => {
  assert.match(dockerfile, /^ARG MERMAID_CLI_VERSION=11\.12\.0$/m);
  assert.match(dockerfile, /PUPPETEER_SKIP_DOWNLOAD=true/);
  assert.match(dockerfile, /mmdc --input \/tmp\/mermaid-smoke\.mmd --output \/tmp\/mermaid-smoke\.png/);
  assert.match(dockerfile, /pnpm install --frozen-lockfile --ignore-scripts/);
  for (const [name, argument] of [
    ["excalidraw-mcp", "EXCALIDRAW_MCP_REVISION"],
    ["mermaid-to-excalidraw", "MERMAID_TO_EXCALIDRAW_REVISION"],
  ]) {
    const revision = execFileSync("git", ["rev-parse", `HEAD:vendor/${name}`], { encoding: "utf8" }).trim();
    assert.match(dockerfile, new RegExp(`^ARG ${argument}=${revision}$`, "m"));
  }
  assert.match(stackHook, /link-vendor-sources! "\/workspace" "\/opt\/vendor"/);
});

test("Docker development VMs use QEMU and require OverlayFS before starting overlay2", () => {
  assert.equal(projectConfig.development.docker, true);
  assert.equal(projectConfig.development.vmm, "qemu");
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
  assert.match(dockerJobAPI, /filepath\.Join\(staging, "agent", "images"\)/);
  assert.match(dockerJobAPI, /gondolin-preload:/);
  assert.match(dockerJobAPI, /\.tar"/);
  assert.match(preloadImporter, /json:"sha256"/);
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
  assert.match(cacheWorkflow, /gondolin-oci compose pull --via-api/);
  assert.doesNotMatch(cacheWorkflow, /node --input-type=module/);
  assert.doesNotMatch(cacheWorkflow, /npm|pnpm|git archive|compose-build-context/);
  assert.match(builderDockerfile, /COPY --from=gondolin-oci-build \/out\/gondolin-oci/);
  const composeAPIClient = fs.readFileSync(new URL("../image-builder/compose_pull_api.go", import.meta.url), "utf8");
  assert.match(composeAPIClient, /DOCKER_JOB_API_VM_TOKEN/);
  assert.match(composeAPIClient, /http:\/\/compose-cache\.local:18080\/v1/);
  assert.match(builderManager, /class DockerJobHostService/);
  assert.match(builderManager, /GONDOLIN_DOCKER_JOB_API_URL/);
  assert.match(dockerJobAPI, /func \(h \*Handler\) pullImage/);
  assert.match(dockerJobAPI, /func \(h \*Handler\) exportImage/);
  assert.match(dockerJobAPI, /\/images\/create/);
  assert.match(dockerJobAPI, /\/images\/get/);
  assert.match(builderDockerfile, /docker\/compose\/releases\/download/);
  assert.doesNotMatch(builderDockerfile, /babashka\/babashka\/releases\/download/);
  assert.match(preloadImporter, /verifyComposeArchive/);
  assert.match(preloadImporter, /Import.*shared image archives/);
});

test("Gitea image builds use the host Docker API and local tar handoff", () => {
  assert.match(builderManager, /class DockerJobHostService/);
  assert.doesNotMatch(builderManager, /dockerd|docker info/);
  assert.doesNotMatch(builderDockerfile, /^\s*(?:containerd|docker)=/m);
  assert.match(builderWorkflow, /runImageBuildViaAPI/);
  assert.match(builderWorkflow, /IMAGE_BASE_PULL_TOKEN/);
  assert.doesNotMatch(builderWorkflow, /docker push|api\/packages|registryRef/);
  assert.match(imageBuildWorkflow, /gondolin-oci image build --via-api/);
  assert.doesNotMatch(imageBuildWorkflow, /workflow\.js/);
  assert.doesNotMatch(builderInstaller, /GITEA_BUILDER_TOKEN|docker.*(?:login|pull)|registry-image/);
  assert.match(dockerJobAPI, /GONDOLIN_IMAGE_BUILDER_HANDOFF/);
  assert.match(dockerJobAPI, /usage: gondolin-oci .*compose pull/);
  assert.match(dockerJobAPIDockerfile, /out\/gondolin-oci/);
  assert.match(dockerJobAPIDockerfile, /ENTRYPOINT \["\/usr\/local\/bin\/gondolin-oci", "serve"\]/);
  assert.match(fs.readFileSync(new URL("../image-builder/compose_cache_import.go", import.meta.url), "utf8"),
    /gondolin-oci compose import/);
  const goCLI = fs.readFileSync(new URL("../image-builder/compose_cli.go", import.meta.url), "utf8");
  assert.match(goCLI, /gondolin-oci compose pull/);
  assert.match(goCLI, /gondolin-oci image build/);
  assert.match(goCLI, /gondolin-oci image export/);
});
