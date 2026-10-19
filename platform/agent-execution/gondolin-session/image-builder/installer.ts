import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildAssets,
  importImageFromDirectory,
  parseBuildConfig,
  resolveImageSelector,
  setImageRef,
  type BuildConfig,
} from "@earendil-works/gondolin";

import { localImageTag } from "./local-image.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/;

function run(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; input?: string } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (chunk: Buffer) => { stdout += chunk; });
    child.stderr!.on("data", (chunk: Buffer) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(`${command} exited with ${code ?? "a signal"}: ${stderr.slice(-4000)}`)));
    if (options.input !== undefined) child.stdin!.end(options.input);
  });
}

export function localCacheReference(digest: string): string {
  if (!DIGEST.test(digest)) throw new Error(`invalid OCI digest: ${digest}`);
  return `oci-cache:${digest.slice("sha256:".length, "sha256:".length + 32)}`;
}

export function assertHostSafeConfig(config: BuildConfig): void {
  if (!config.oci) throw new Error("assetConfig must declare an OCI rootfs");
  if (config.init || config.postBuild) {
    throw new Error("host OCI conversion does not allow init or postBuild configuration");
  }
  if (config.container || config.sandboxdPath || config.sandboxfsPath
    || config.sandboxsshPath || config.sandboxingressPath) {
    throw new Error("host OCI conversion does not allow custom build executables");
  }
  if (config.alpine?.mirror) {
    throw new Error("host OCI conversion does not allow a custom Alpine mirror");
  }
}

function cachedImage(cacheReference: string, imageRef: string, arch: BuildConfig["arch"]) {
  try {
    const cached = resolveImageSelector(cacheReference, arch);
    if (!cached.buildId || !cached.arch) return undefined;
    const reference = setImageRef(imageRef, cached.buildId, cached.arch);
    return {
      arch: cached.arch,
      buildId: cached.buildId,
      cached: true,
      reference: reference.reference,
    };
  } catch {
    return undefined;
  }
}

async function importDockerImage(
  assetConfigPath: string,
  config: BuildConfig,
  dockerImage: string,
  imageRef: string,
  temporary: string,
  cacheReference?: string,
) {
  config.oci = {
    image: dockerImage,
    runtime: "docker",
    platform: config.oci!.platform ?? `linux/${config.arch}`,
    pullPolicy: "never",
  };
  const assets = path.join(temporary, "assets");
  await buildAssets(config, {
    configDir: path.dirname(assetConfigPath),
    outputDir: assets,
    verbose: true,
    workDir: path.join(temporary, "work"),
  });
  const imported = importImageFromDirectory(assets);
  if (cacheReference) setImageRef(cacheReference, imported.buildId, imported.arch);
  const reference = setImageRef(imageRef, imported.buildId, imported.arch);
  return { arch: imported.arch, buildId: imported.buildId, cached: false, reference: reference.reference };
}

async function main() {
  if (process.argv[2] === "inspect") {
    const [, assetConfigPath, imageRef] = process.argv.slice(2);
    if (!assetConfigPath || !imageRef) {
      throw new Error("usage: image-builder/installer inspect <asset-config> <image-ref>");
    }
    const config = parseBuildConfig(fs.readFileSync(assetConfigPath, "utf8"));
    let present = false;
    try {
      const image = resolveImageSelector(imageRef, config.arch);
      present = Boolean(image.buildId && image.arch);
    } catch {
      // A missing or unusable local ref must be installed before Pi starts.
    }
    process.stdout.write(`${JSON.stringify({ present })}\n`);
    return;
  }
  if (process.argv[2] === "local-install") {
    const [, assetConfigPath, archivePath, imageRef, artifactVersion] = process.argv.slice(2);
    if (!assetConfigPath || !archivePath || !imageRef || !/^v2-[a-f0-9]{32}$/.test(artifactVersion ?? "")) {
      throw new Error("usage: image-builder/installer local-install <asset-config> <archive> <image-ref> <artifact-version>");
    }
    if (path.basename(archivePath) !== `${artifactVersion}.tar` || !fs.lstatSync(archivePath).isFile()) {
      throw new Error("local image archive must be a regular versioned file");
    }
    const config = parseBuildConfig(fs.readFileSync(assetConfigPath, "utf8"));
    assertHostSafeConfig(config);
    const cached = cachedImage(imageRef, imageRef, config.arch);
    if (cached) {
      process.stdout.write(`${JSON.stringify(cached)}\n`);
      return;
    }
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "gondolin-oci-install-"));
    try {
      await run("docker", ["load", "--input", archivePath]);
      const dockerImage = localImageTag(artifactVersion!);
      await run("docker", ["image", "inspect", "--format", "{{.Id}}", dockerImage]);
      const installed = await importDockerImage(assetConfigPath, config, dockerImage, imageRef, temporary);
      process.stdout.write(`${JSON.stringify(installed)}\n`);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
    return;
  }
  const [assetConfigPath, registryImage, imageRef, digest] = process.argv.slice(2);
  const token = process.env.GITEA_BUILDER_TOKEN;
  if (!assetConfigPath || !registryImage || !imageRef || !digest || !token) {
    throw new Error(
      "usage: image-builder/installer <asset-config> <registry-image> <image-ref> <sha256:digest>; "
        + "GITEA_BUILDER_TOKEN is required",
    );
  }
  if (!DIGEST.test(digest) || !registryImage.endsWith(`@${digest}`)) {
    throw new Error("registry image must be pinned to the expected sha256 digest");
  }
  const config = parseBuildConfig(fs.readFileSync(assetConfigPath, "utf8"));
  assertHostSafeConfig(config);
  const cacheReference = localCacheReference(digest);
  const cached = cachedImage(cacheReference, imageRef, config.arch);
  if (cached) {
    process.stdout.write(`${JSON.stringify(cached)}\n`);
    return;
  }

  const slash = registryImage.indexOf("/");
  const registry = slash > 0 ? registryImage.slice(0, slash) : "";
  if (!registry || !/^(127\.0\.0\.1|localhost):[0-9]+$/.test(registry)) {
    throw new Error(`registry must be an explicit loopback endpoint: ${registry}`);
  }
  const dockerConfig = fs.mkdtempSync(path.join(os.tmpdir(), "gondolin-docker-config-"));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "gondolin-oci-install-"));
  const previousDockerConfig = process.env.DOCKER_CONFIG;
  try {
    const dockerEnv = { ...process.env, DOCKER_CONFIG: dockerConfig };
    await run(
      "docker",
      ["login", registry, "--username", "image-builder", "--password-stdin"],
      { env: dockerEnv, input: `${token}\n` },
    );
    await run("docker", ["pull", "--platform", config.oci!.platform ?? `linux/${config.arch}`, registryImage], {
      env: dockerEnv,
    });
    process.env.DOCKER_CONFIG = dockerConfig;
    const installed = await importDockerImage(
      assetConfigPath, config, registryImage, imageRef, temporary, cacheReference,
    );
    process.stdout.write(`${JSON.stringify({
      ...installed,
      digest,
    })}\n`);
  } finally {
    if (previousDockerConfig === undefined) delete process.env.DOCKER_CONFIG;
    else process.env.DOCKER_CONFIG = previousDockerConfig;
    fs.rmSync(dockerConfig, { recursive: true, force: true });
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
