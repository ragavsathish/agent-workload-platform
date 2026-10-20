#!/usr/bin/env node

import { readFileSync } from "node:fs";

const [resultsPath] = process.argv.slice(2);
if (!resultsPath) {
  throw new Error("Usage: node publish-otel.mjs <results.json>");
}

const results = JSON.parse(readFileSync(resultsPath, "utf8"));
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://127.0.0.1:4318";
const timestamp = String(BigInt(Date.now()) * 1_000_000n);
const attribute = (key, value) => ({ key, value: { stringValue: String(value) } });
const point = (benchmarkId, value, attributes = {}) => ({
  attributes: Object.entries({ benchmark_id: benchmarkId, ...attributes })
    .map(([key, entry]) => attribute(key, entry)),
  timeUnixNano: timestamp,
  asDouble: value,
});
const gauge = (name, unit, dataPoints) => ({ name, unit, gauge: { dataPoints } });

const benchmarks = results.benchmarks ?? [results];
if (!Array.isArray(benchmarks) || benchmarks.length === 0) {
  throw new Error("Results must contain a benchmark or benchmarks array");
}
const resourceMetrics = [];
for (const benchmark of benchmarks) {
  if (typeof benchmark.id !== "string" || !Array.isArray(benchmark.tiers) ||
      typeof benchmark.host?.model !== "string") {
    throw new Error("Each benchmark must contain an id, host.model, and tiers array");
  }
  for (const tier of benchmark.tiers) {
    if (!Number.isInteger(tier.parallelism) || tier.parallelism < 1 ||
        !Array.isArray(tier.durationsSeconds) || tier.durationsSeconds.length !== tier.parallelism ||
        tier.durationsSeconds.some((value) => !Number.isFinite(value) || value <= 0) ||
        !Number.isInteger(tier.successes) || tier.successes < 0 || tier.successes > tier.parallelism) {
      throw new Error(`Invalid benchmark tier: ${JSON.stringify(tier)}`);
    }
  }

  const tierPoint = (field, map = (value) => value) => benchmark.tiers.map((tier) => {
    const value = map(tier[field]);
    if (!Number.isFinite(value)) throw new Error(`Invalid ${field} for tier ${tier.parallelism}`);
    return point(benchmark.id, value, { parallelism: tier.parallelism });
  });
  const metrics = [
    gauge("awp_dev_benchmark_run_duration_seconds", "s", benchmark.tiers.flatMap((tier) =>
      tier.durationsSeconds.map((seconds, index) => point(benchmark.id, seconds, {
        parallelism: tier.parallelism,
        run: index + 1,
      })))),
    gauge("awp_dev_benchmark_success_count", "", tierPoint("successes")),
    gauge("awp_dev_benchmark_peak_vm_rss_bytes", "By", tierPoint("peakVmRssBytes")),
    gauge("awp_dev_benchmark_min_host_free_memory_percent", "%", tierPoint("minHostFreeMemoryPercent")),
    gauge("awp_dev_benchmark_swap_growth_bytes", "By", tierPoint("swapGrowthMiB", (value) => value * 1_048_576)),
    gauge("awp_dev_benchmark_min_free_disk_bytes", "By", tierPoint("minFreeDiskGiB", (value) => value * 1_073_741_824)),
  ];
  resourceMetrics.push({
    resource: { attributes: [
      attribute("service.name", "awp-dev-concurrency-benchmark"),
      attribute("benchmark.id", benchmark.id),
      attribute("host.model", benchmark.host.model),
    ] },
    scopeMetrics: [{ scope: { name: "awp.dev-concurrency-benchmark" }, metrics }],
  });
}

for (const comparison of results.storageComparisons ?? []) {
  if (typeof comparison.id !== "string" || typeof comparison.host?.model !== "string" ||
      !comparison.drivers?.vfs || !comparison.drivers?.overlay2) {
    throw new Error("Storage comparisons must contain id, host.model, and vfs/overlay2 drivers");
  }
  const driverPoints = (field) => ["vfs", "overlay2"].map((driver) => {
    const value = comparison.drivers[driver][field];
    if (!Number.isFinite(value)) throw new Error(`Invalid ${field} for ${driver}`);
    return point(comparison.id, value, { driver });
  });
  const metrics = [
    gauge("awp_dev_compose_startup_duration_seconds", "s", driverPoints("startupMs").map((item) => ({
      ...item,
      asDouble: item.asDouble / 1_000,
    }))),
    gauge("awp_dev_compose_rootfs_used_bytes", "By", driverPoints("rootfsUsedBytes")),
    gauge("awp_dev_compose_rootfs_available_bytes", "By", driverPoints("rootfsAvailableBytes")),
    gauge("awp_dev_compose_docker_apparent_bytes", "By", driverPoints("dockerApparentBytes")),
    gauge("awp_dev_compose_driver_directory_apparent_bytes", "By", ["vfs", "overlay2"].map((driver) => {
      const field = driver === "vfs" ? "dockerVfsApparentBytes" : "dockerOverlay2ApparentBytes";
      const value = comparison.drivers[driver][field];
      if (!Number.isFinite(value)) throw new Error(`Invalid ${field} for ${driver}`);
      return point(comparison.id, value, { driver });
    })),
  ];
  resourceMetrics.push({
    resource: { attributes: [
      attribute("service.name", "awp-compose-storage-benchmark"),
      attribute("benchmark.id", comparison.id),
      attribute("host.model", comparison.host.model),
    ] },
    scopeMetrics: [{ scope: { name: "awp.compose-storage-benchmark" }, metrics }],
  });
}

if (results.lifecycle) {
  const { id, host, coldStartMedianMs, resumeMedianMs, freshCheckpointMs,
    freshCheckpointAllocatedBytes, patrolCheckpointMs, patrolCheckpointAllocatedBytes } = results.lifecycle;
  if (typeof id !== "string" || typeof host?.model !== "string") {
    throw new Error("Lifecycle results must contain id and host.model");
  }
  const metrics = [
    gauge("awp_dev_vm_startup_duration_seconds", "s", [point(id, coldStartMedianMs / 1_000, { phase: "cold" })]),
    gauge("awp_dev_vm_resume_duration_seconds", "s", [point(id, resumeMedianMs / 1_000, { phase: "patrol-checkpoint" })]),
    gauge("awp_dev_vm_checkpoint_duration_seconds", "s", [
      point(id, freshCheckpointMs / 1_000, { checkpoint: "fresh" }),
      point(id, patrolCheckpointMs / 1_000, { checkpoint: "patrol-after-resume" }),
    ]),
    gauge("awp_dev_vm_checkpoint_allocated_bytes", "By", [
      point(id, freshCheckpointAllocatedBytes, { checkpoint: "fresh" }),
      point(id, patrolCheckpointAllocatedBytes, { checkpoint: "patrol-after-resume" }),
    ]),
  ];
  resourceMetrics.push({
    resource: { attributes: [
      attribute("service.name", "awp-dev-concurrency-benchmark"),
      attribute("benchmark.id", id),
      attribute("host.model", host.model),
    ] },
    scopeMetrics: [{ scope: { name: "awp.dev-concurrency-benchmark" }, metrics }],
  });
}
const payload = {
  resourceMetrics,
};
const response = await fetch(new URL("v1/metrics", `${endpoint.replace(/\/+$/, "")}/`), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(10_000),
});
if (!response.ok) {
  throw new Error(`OTLP export failed: ${response.status} ${await response.text()}`);
}
console.log(`Published ${resourceMetrics.length} benchmark result groups from ${resultsPath}`);
