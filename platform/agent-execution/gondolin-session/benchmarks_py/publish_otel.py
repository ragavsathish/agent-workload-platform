"""Publish saved benchmark measurements as OTLP JSON gauges."""

from __future__ import annotations

import argparse
import json
import math
import os
import time
import urllib.request
from pathlib import Path


def attribute(key, value):
    return {"key": key, "value": {"stringValue": str(value)}}


def point(benchmark_id, value, attributes=None):
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"nonfinite metric for {benchmark_id}")
    tags = {"benchmark_id": benchmark_id, **(attributes or {})}
    return {"attributes": [attribute(key, entry) for key, entry in tags.items()],
            "timeUnixNano": str(time.time_ns()), "asDouble": value}


def gauge(name, unit, points):
    return {"name": name, "unit": unit, "gauge": {"dataPoints": points}}


def resource(service, scope, benchmark_id, host_model, metrics):
    return {
        "resource": {"attributes": [attribute("service.name", service),
                                    attribute("benchmark.id", benchmark_id),
                                    attribute("host.model", host_model)]},
        "scopeMetrics": [{"scope": {"name": scope}, "metrics": metrics}],
    }


def tier_metrics(benchmark):
    benchmark_id = benchmark["id"]
    tiers = benchmark["tiers"]
    def tier_points(field, scale=1):
        return [point(benchmark_id, tier[field] * scale, {"parallelism": tier["parallelism"]})
                for tier in tiers]
    return [
        gauge("awp_dev_benchmark_run_duration_seconds", "s", [
            point(benchmark_id, seconds, {"parallelism": tier["parallelism"], "run": index + 1})
            for tier in tiers for index, seconds in enumerate(tier["durationsSeconds"])]),
        gauge("awp_dev_benchmark_success_count", "", tier_points("successes")),
        gauge("awp_dev_benchmark_peak_vm_rss_bytes", "By", tier_points("peakVmRssBytes")),
        gauge("awp_dev_benchmark_min_host_free_memory_percent", "%",
              tier_points("minHostFreeMemoryPercent")),
        gauge("awp_dev_benchmark_swap_growth_bytes", "By", tier_points("swapGrowthMiB", 1048576)),
        gauge("awp_dev_benchmark_min_free_disk_bytes", "By",
              tier_points("minFreeDiskGiB", 1073741824)),
    ]


def storage_metrics(comparison):
    benchmark_id = comparison["id"]
    drivers = comparison["drivers"]
    def points(field, scale=1):
        return [point(benchmark_id, drivers[driver][field] * scale, {"driver": driver})
                for driver in ("vfs", "overlay2")]
    return [
        gauge("awp_dev_compose_startup_duration_seconds", "s", points("startupMs", 0.001)),
        gauge("awp_dev_compose_rootfs_used_bytes", "By", points("rootfsUsedBytes")),
        gauge("awp_dev_compose_rootfs_available_bytes", "By", points("rootfsAvailableBytes")),
        gauge("awp_dev_compose_docker_apparent_bytes", "By", points("dockerApparentBytes")),
        gauge("awp_dev_compose_driver_directory_apparent_bytes", "By", [
            point(benchmark_id, drivers[driver]["dockerVfsApparentBytes" if driver == "vfs"
                                               else "dockerOverlay2ApparentBytes"], {"driver": driver})
            for driver in ("vfs", "overlay2")]),
    ]


def parallel_metrics(benchmark):
    benchmark_id = benchmark["id"]
    tags = {"parallelism": benchmark["parallelism"], "outcome": benchmark.get("outcome", "unknown")}
    readiness = benchmark["readinessMs"]
    metrics = [
        gauge("awp_dev_compose_parallel_ready_vm_count", "", [point(
            benchmark_id, sum(isinstance(value, (int, float)) for value in readiness), tags)]),
        gauge("awp_dev_compose_parallel_vm_readiness_duration_seconds", "s", [
            point(benchmark_id, value / 1000, {**tags, "vm": index + 1})
            for index, value in enumerate(readiness) if isinstance(value, (int, float))]),
    ]
    if isinstance(benchmark.get("wallClockMs"), (int, float)):
        metrics.append(gauge("awp_dev_compose_parallel_wall_clock_seconds", "s", [
            point(benchmark_id, benchmark["wallClockMs"] / 1000, tags)]))
    for name, unit, field, scale in (
        ("awp_dev_compose_parallel_min_host_free_memory_percent", "%", "minFreeMemoryPercent", 1),
        ("awp_dev_compose_parallel_swap_growth_bytes", "By", "swapGrowthMiB", 1048576),
        ("awp_dev_compose_parallel_min_free_disk_bytes", "By", "minFreeDiskGiB", 1073741824),
    ):
        if isinstance(benchmark.get(field), (int, float)):
            metrics.append(gauge(name, unit, [point(benchmark_id, benchmark[field] * scale, tags)]))
    return metrics


def lifecycle_metrics(lifecycle):
    benchmark_id = lifecycle["id"]
    return [
        gauge("awp_dev_vm_startup_duration_seconds", "s", [
            point(benchmark_id, lifecycle["coldStartMedianMs"] / 1000, {"phase": "cold"})]),
        gauge("awp_dev_vm_resume_duration_seconds", "s", [
            point(benchmark_id, lifecycle["resumeMedianMs"] / 1000, {"phase": "patrol-checkpoint"})]),
        gauge("awp_dev_vm_checkpoint_duration_seconds", "s", [
            point(benchmark_id, lifecycle["freshCheckpointMs"] / 1000, {"checkpoint": "fresh"}),
            point(benchmark_id, lifecycle["patrolCheckpointMs"] / 1000,
                  {"checkpoint": "patrol-after-resume"})]),
        gauge("awp_dev_vm_checkpoint_allocated_bytes", "By", [
            point(benchmark_id, lifecycle["freshCheckpointAllocatedBytes"], {"checkpoint": "fresh"}),
            point(benchmark_id, lifecycle["patrolCheckpointAllocatedBytes"],
                  {"checkpoint": "patrol-after-resume"})]),
    ]


def payload(results):
    groups = []
    benchmarks = results.get("benchmarks", [results] if "tiers" in results else [])
    for benchmark in benchmarks:
        groups.append(resource("awp-dev-concurrency-benchmark", "awp.dev-concurrency-benchmark",
                               benchmark["id"], benchmark["host"]["model"], tier_metrics(benchmark)))
    for comparison in results.get("storageComparisons", []):
        groups.append(resource("awp-compose-storage-benchmark", "awp.compose-storage-benchmark",
                               comparison["id"], comparison["host"]["model"], storage_metrics(comparison)))
    for benchmark in results.get("composeParallelBenchmarks", []):
        groups.append(resource("awp-compose-parallel-benchmark", "awp.compose-parallel-benchmark",
                               benchmark["id"], benchmark["host"]["model"], parallel_metrics(benchmark)))
    if results.get("lifecycle"):
        lifecycle = results["lifecycle"]
        groups.append(resource("awp-dev-concurrency-benchmark", "awp.dev-concurrency-benchmark",
                               lifecycle["id"], lifecycle["host"]["model"], lifecycle_metrics(lifecycle)))
    return {"resourceMetrics": groups}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("results", type=Path)
    parser.add_argument("--endpoint", default=os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT",
                                                       "http://127.0.0.1:4318"))
    args = parser.parse_args()
    results = json.loads(args.results.read_text(encoding="utf-8"))
    metrics = payload(results)
    body = json.dumps(metrics).encode("utf-8")
    request = urllib.request.Request(args.endpoint.rstrip("/") + "/v1/metrics", data=body,
                                     headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"OTLP export failed: HTTP {response.status}")
    print("Published {} benchmark result groups".format(len(metrics["resourceMetrics"])))


if __name__ == "__main__":
    main()
