#!/usr/bin/env node
/** Measure the same Gondolin VM configuration used by the retained Patrol tier. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { GondolinSession } from "../dist/session.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const benchmarkDir = path.dirname(fileURLToPath(import.meta.url));
const sourceArg = process.argv[2];
if (!sourceArg) {
  throw new Error("Usage: node benchmark-task-vm-lifecycle.mjs <patrol-run-result.json>");
}
const source = path.resolve(sourceArg);
const prior = JSON.parse(fs.readFileSync(source, "utf8"));
const image = prior.vm.image;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "gondolin-lifecycle-bench-"));
const stamp = new Date().toISOString().replace(/[:.]/g, "").replace(".000", "");
const output = path.join(benchmarkDir, "benchmark-results.json");
const mib = 1024 ** 2;

process.env.GONDOLIN_DEV_ASSETS ??= path.join(root, "artifacts/gondolin-browser/aarch64");

function command(name, args) {
  return execFileSync(name, args, { encoding: "utf8" }).trim();
}

function swapUsedMiB() {
  const match = command("sysctl", ["vm.swapusage"]).match(/used = ([\d.]+)M/);
  return match ? Number(match[1]) : null;
}

function disk(pathname) {
  const stat = fs.statSync(pathname);
  const info = JSON.parse(command("qemu-img", ["info", "--output=json", pathname]));
  return {
    fileBytes: stat.size,
    allocatedBytes: stat.blocks * 512,
    virtualBytes: info["virtual-size"],
    format: info.format,
  };
}

function directoryBytes(pathname) {
  return Number(command("du", ["-sk", pathname]).split(/\s+/)[0]) * 1024;
}

function options(workspace, resumeCheckpointPath) {
  return {
    imagePath: image,
    mounts: { "/workspace": workspace },
    network: { allowedHosts: ["*"] },
    environment: {
      PATH: "/opt/flutter/bin:/opt/flutter/bin/cache/dart-sdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      FLUTTER_HOME: "/opt/flutter",
      FLUTTER_ROOT: "/opt/flutter",
      PUB_CACHE: "/var/cache/pub",
      PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright",
      PATROL_WEB_LOCALE: "en-US",
      PATROL_WEB_IGNORE_HTTPS_ERRORS: "true",
    },
    memory: "8G",
    cpus: 4,
    rootfs: { mode: "cow", size: "64G" },
    maxHttpResponseBodyBytes: 512 * mib,
    startupCommands: [
      ["/usr/local/bin/start-dev-docker"],
      ["/usr/local/bin/node", "/workspace/.pi/hooks/start-dev-stack.mjs"],
    ],
    sessionLabel: "pi-dev-worktree",
    resumeCheckpointPath,
  };
}

async function trial(kind, workspace, checkpointPath, saveCheckpointPath) {
  const session = new GondolinSession(options(workspace, checkpointPath));
  const baselineSwap = swapUsedMiB();
  const started = performance.now();
  try {
    await session.start();
    const ready = performance.now();
    const commandResult = await session.run(["/bin/true"]);
    const commandDone = performance.now();
    if (!commandResult.ok) throw new Error(`Guest probe failed: ${commandResult.exitCode}`);
    let checkpointMs = null;
    let savedDisk = null;
    if (saveCheckpointPath) {
      const beforeCheckpoint = performance.now();
      await session.checkpoint(saveCheckpointPath);
      checkpointMs = Math.round(performance.now() - beforeCheckpoint);
      savedDisk = disk(saveCheckpointPath);
    }
    const result = {
      kind,
      checkpoint: checkpointPath
        ? (checkpointPath.startsWith(scratch) ? "temporary-cold-checkpoint" : path.relative(root, checkpointPath))
        : null,
      startupMs: Math.round(ready - started),
      firstCommandMs: Math.round(commandDone - ready),
      checkpointMs,
      savedDisk,
      swapGrowthMiB: baselineSwap === null ? null : Math.round((swapUsedMiB() - baselineSwap) * 100) / 100,
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    await session.close();
  }
}

const result = {
  measuredAtUtc: new Date().toISOString(),
  host: prior.host,
  vm: { ...prior.vm, diskLimitGiB: 64 },
  method: "Sequential GondolinSession.start with Docker and dev hook; first /bin/true; checkpoint excludes Pi and Patrol model/tool time",
  retained: prior.runs.map(run => {
    const workspace = path.join(root, run.workspace);
    const checkpoint = `${path.join(root, run.sessionFile)}.gondolin.qcow2`;
    return { index: run.index, patrolExitCode: run.commandExitCode,
      workspace: run.workspace, workspaceBytes: directoryBytes(workspace),
      checkpoint: path.relative(root, checkpoint), checkpointDisk: disk(checkpoint) };
  }),
  trials: [],
};

try {
  const workspace = path.join(root, prior.runs[0].workspace);
  for (let i = 0; i < 3; i++) {
    result.trials.push(await trial("cold", workspace, undefined,
      i === 0 ? path.join(scratch, "cold.qcow2") : undefined));
  }
  result.trials.push(await trial("fresh-checkpoint-resume", workspace, path.join(scratch, "cold.qcow2")));
  for (const run of prior.runs) {
    const checkpoint = `${path.join(root, run.sessionFile)}.gondolin.qcow2`;
    result.trials.push(await trial(`patrol-checkpoint-${run.index}-resume`, path.join(root, run.workspace), checkpoint,
      run.index === 1 ? path.join(scratch, "warm.qcow2") : undefined));
  }
  result.completed = true;
} catch (error) {
  result.completed = false;
  result.error = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  result.finishedAtUtc = new Date().toISOString();
  const results = JSON.parse(fs.readFileSync(output, "utf8"));
  if (result.completed) {
    const cold = result.trials.filter(trial => trial.kind === "cold");
    const patrolResume = result.trials.filter(trial => trial.kind.startsWith("patrol-checkpoint-"));
    const freshCheckpoint = cold.find(trial => trial.savedDisk);
    const patrolCheckpoint = patrolResume.find(trial => trial.savedDisk);
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    results.lifecycle = {
      id: `mac-m4-pro-${stamp}-vm-lifecycle`,
      host: result.host,
      vm: result.vm,
      measuredAtUtc: result.measuredAtUtc,
      coldStartMedianMs: median(cold.map(trial => trial.startupMs)),
      coldStartTrialsMs: cold.map(trial => trial.startupMs),
      freshCheckpointResumeMs: result.trials.find(trial => trial.kind === "fresh-checkpoint-resume").startupMs,
      resumeMedianMs: median(patrolResume.map(trial => trial.startupMs)),
      patrolCheckpointResumeTrialsMs: patrolResume.map(trial => trial.startupMs),
      freshCheckpointMs: freshCheckpoint.checkpointMs,
      freshCheckpointAllocatedBytes: freshCheckpoint.savedDisk.allocatedBytes,
      patrolCheckpointMs: patrolCheckpoint.checkpointMs,
      patrolCheckpointAllocatedBytes: patrolCheckpoint.savedDisk.allocatedBytes,
      method: result.method,
    };
    results.generatedAtUtc = result.finishedAtUtc;
  } else {
    results.lifecycle.lastFailedAttempt = {
      measuredAtUtc: result.measuredAtUtc,
      finishedAtUtc: result.finishedAtUtc,
      error: result.error,
    };
  }
  fs.writeFileSync(output, `${JSON.stringify(results, null, 2)}\n`);
  fs.rmSync(scratch, { recursive: true, force: true });
  console.log(`RESULT ${output}`);
}
