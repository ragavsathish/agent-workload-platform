#!/usr/bin/env node

// Run on the trusted host once; it never builds application source.
// The resulting Docker archive is mounted read-only into every dev VM.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [composeArgument, cacheArgument] = process.argv.slice(2);
if (!composeArgument || !cacheArgument) {
  throw new Error("Usage: prepare-compose-cache.mjs <compose.yml> <cache-directory>");
}

const composePath = path.resolve(composeArgument);
const cacheDirectory = path.resolve(cacheArgument);
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
function validateArchive(archive) {
  const files = new Set(execFileSync("tar", ["-tf", archive], { encoding: "utf8" }).trim().split("\n"));
  const manifests = JSON.parse(execFileSync("tar", ["-xOf", archive, "manifest.json"], { encoding: "utf8" }));
  for (const manifest of manifests) {
    for (const file of [manifest.Config, ...manifest.Layers]) {
      if (!files.has(file)) {
        throw new Error(`incomplete Docker image archive ${archive}: missing ${file}`);
      }
    }
  }
}
const config = JSON.parse(docker("compose", "-f", composePath, "config", "--format", "json"));
if (!config.services || typeof config.services !== "object") {
  throw new Error("Compose configuration has no services");
}

const services = {};
const images = new Map();
const serviceImages = {};
for (const [name, service] of Object.entries(config.services)) {
  if (!service.image) continue;
  let imageId;
  try {
    imageId = docker("image", "inspect", service.image, "--format", "{{.Id}}");
  } catch {
    if (service.build) {
      throw new Error(`${name} is built from source. Build it inside a VM and promote its image before preparing the shared cache.`);
    }
    docker("pull", service.image);
    imageId = docker("image", "inspect", service.image, "--format", "{{.Id}}");
  }
  const key = createHash("sha256").update(`${service.image}\n${imageId}`).digest("hex").slice(0, 24);
  const cacheTag = `gondolin-cache:${key}`;
  docker("tag", imageId, cacheTag);
  images.set(cacheTag, { source: service.image, imageId });
  services[name] = { image: cacheTag, pull_policy: "never" };
  serviceImages[name] = { image: cacheTag, archive: `${key}.tar` };
}

if (images.size === 0) throw new Error("Compose configuration has no images to cache");
const cacheId = createHash("sha256")
  .update(JSON.stringify([...images].sort(([left], [right]) => left.localeCompare(right))))
  .digest("hex");
fs.mkdirSync(cacheDirectory, { recursive: true });
const imageDirectory = path.join(cacheDirectory, "images");
fs.mkdirSync(imageDirectory, { recursive: true });
for (const image of images.keys()) {
  const archive = path.join(imageDirectory, `${image.split(":")[1]}.tar`);
  if (fs.existsSync(archive)) {
    validateArchive(archive);
    continue;
  }
  const temporaryArchive = `${archive}.${process.pid}.tmp`;
  try {
    docker("save", "--output", temporaryArchive, image);
    validateArchive(temporaryArchive);
    fs.renameSync(temporaryArchive, archive);
  } finally {
    fs.rmSync(temporaryArchive, { force: true });
  }
}
fs.writeFileSync(path.join(cacheDirectory, "compose.override.json"), `${JSON.stringify({ services }, null, 2)}\n`);
fs.writeFileSync(path.join(cacheDirectory, "index.json"), `${JSON.stringify({ services: serviceImages }, null, 2)}\n`);
fs.writeFileSync(path.join(cacheDirectory, "cache-id"), `${cacheId}\n`);
// Remove only the archive produced by the older eager-cache implementation.
fs.rmSync(path.join(cacheDirectory, "images.tar"), { force: true });
console.log(`Cached ${images.size} image tags for ${Object.keys(services).length} Compose services in ${cacheDirectory}`);
