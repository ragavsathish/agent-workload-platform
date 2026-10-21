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

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (chunk: Buffer) => { stdout += chunk; });
    child.stderr!.on("data", (chunk: Buffer) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(`${command} exited with ${code ?? "a signal"}: ${stderr.slice(-4000)}`)));
  });
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
      const dockerImage = localImageTag(artifactVersion);
      await run("docker", ["image", "inspect", "--format", "{{.Id}}", dockerImage]);
      const installed = await importDockerImage(assetConfigPath, config, dockerImage, imageRef, temporary);
      process.stdout.write(`${JSON.stringify(installed)}\n`);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
    return;
  }
  throw new Error("usage: image-builder/installer <inspect|local-install> ...");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
