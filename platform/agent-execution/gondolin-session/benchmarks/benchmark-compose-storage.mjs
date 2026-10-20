#!/usr/bin/env node

import { GondolinSession } from "../dist/session.js";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const [image, driver] = process.argv.slice(2);
if (!image || !["vfs", "overlay2"].includes(driver)) {
  throw new Error("Usage: node benchmark-compose-storage.mjs <GONDOLIN_IMAGE> <vfs|overlay2>");
}

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const imageCache = process.env.GONDOLIN_DEV_IMAGE_CACHE ?? `${root}/artifacts/gondolin-dev-images/aarch64`;
const session = new GondolinSession({
  imagePath: image,
  mounts: {
    "/workspace": root,
    "/image-cache": { hostPath: imageCache, readonly: true },
  },
  network: { allowedHosts: ["*"] },
  environment: {
    PATH: "/opt/flutter/bin:/opt/flutter/bin/cache/dart-sdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    GONDOLIN_COMPOSE_PROFILE: "full-mock",
  },
  sandbox: { vmm: "krun" },
  memory: "8G",
  cpus: 4,
  rootfs: { mode: "cow", size: "64G" },
  maxHttpResponseBodyBytes: 512 * 1024 * 1024,
  startupCommands: [
    ["/usr/local/bin/start-dev-docker"],
    ["/usr/local/bin/node", "/workspace/.pi/hooks/start-dev-stack.mjs"],
  ],
  sessionLabel: `compose-storage-benchmark-${driver}`,
});

const started = performance.now();
try {
  await session.start();
  const startupMs = Math.round(performance.now() - started);
  const metrics = await session.run(["/bin/sh", "-lc", `set -eu
printf 'driver='; docker info --format '{{.Driver}}'; printf '\n'
printf 'rootfs='; df -B1 --output=size,used,avail / | tail -1 | xargs; printf '\n'
printf 'docker_apparent_bytes='; du -sb /var/lib/docker | cut -f1; printf '\n'
printf 'docker_vfs_apparent_bytes='
if [ -d /var/lib/docker/vfs/dir ]; then du -sb /var/lib/docker/vfs/dir | cut -f1; else printf 'n/a'; fi
printf '\n'
printf 'docker_overlay2_apparent_bytes='
if [ -d /var/lib/docker/overlay2 ]; then du -sb /var/lib/docker/overlay2 | cut -f1; else printf 'n/a'; fi
printf '\n'
printf 'image_count='; docker image ls -q | sort -u | wc -l | xargs; printf '\n'
`]);
  console.log(JSON.stringify({
    driver,
    image,
    startupMs,
    probeExitCode: metrics.exitCode,
    metrics: metrics.stdout.trim(),
    stderr: metrics.stderr.trim(),
  }));
} catch (error) {
  console.error(JSON.stringify({
    driver,
    image,
    elapsedMs: Math.round(performance.now() - started),
    error: String(error),
    stack: error?.stack,
  }));
  process.exitCode = 1;
} finally {
  await session.close();
}
