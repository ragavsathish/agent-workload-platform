"""Measure concurrent full-mock Compose VM readiness and host headroom."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import platform
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path

from compose_common import DEFAULT_BOOTSTRAP, guest_disk_metrics, options
from host_metrics import free_disk_gib, free_memory_percent, output, sample, swap_mib
from results import save, stamp
from vm_client import VMClient


def measure(image, workspace, *, compose_file=None, workload_command=None,
            bootstrap_command=None, compose_wait=True, image_cache=None,
            guest_environment=None,
            expected_driver="overlay2", parallelism=2, memory_gib=6, cpus=2,
            guest_swap_gib=0, vmm="qemu", min_free_memory_percent=25,
            max_swap_growth_mib=256, min_free_disk_gib=30,
            vm_factory=VMClient, clock=time.monotonic):
    workspace = Path(workspace).resolve()
    baseline_swap = swap_mib()
    baseline = {
        "freeMemoryPercent": free_memory_percent(),
        "swapUsedMiB": baseline_swap["used"],
        "freeDiskGiB": free_disk_gib(workspace),
    }
    if baseline["freeMemoryPercent"] < min_free_memory_percent:
        raise RuntimeError("host free memory is below the configured floor before startup")
    if baseline["freeDiskGiB"] < min_free_disk_gib:
        raise RuntimeError("host free disk is below the configured floor before startup")
    started_at = datetime.now(UTC)
    started = clock()
    clients = [vm_factory() for _ in range(parallelism)]
    ready = [None] * parallelism
    samples = []
    metrics = []
    error = None
    finished_startup = None
    try:
        pool = concurrent.futures.ThreadPoolExecutor(max_workers=parallelism)
        try:
            futures = {
                pool.submit(client.start, options(
                    image, workspace=workspace, compose_file=compose_file,
                    workload_command=workload_command,
                    bootstrap_command=bootstrap_command if bootstrap_command is not None else DEFAULT_BOOTSTRAP,
                    compose_wait=compose_wait, image_cache=image_cache,
                    guest_environment=guest_environment or {},
                    label=f"compose-parallel-{expected_driver}-{index + 1}",
                    vmm=vmm, memory_gib=memory_gib, cpus=cpus,
                    guest_swap_gib=guest_swap_gib)): index
                for index, client in enumerate(clients)
            }
            while futures:
                completed, _ = concurrent.futures.wait(
                    futures, timeout=1, return_when=concurrent.futures.FIRST_COMPLETED)
                item = sample(workspace, baseline_swap["used"], started, clock)
                item["phase"] = "startup"
                samples.append(item)
                for future in completed:
                    index = futures.pop(future)
                    future.result()
                    ready[index] = round((clock() - started) * 1000)
                if item["freeMemoryPercent"] < min_free_memory_percent:
                    raise RuntimeError("host free memory crossed the configured floor")
                if item["swapGrowthMiB"] > max_swap_growth_mib:
                    raise RuntimeError("host swap growth crossed the configured ceiling")
                if item["freeDiskGiB"] < min_free_disk_gib:
                    raise RuntimeError("host free disk crossed the configured floor")
        except Exception:
            with concurrent.futures.ThreadPoolExecutor(max_workers=parallelism) as stopping:
                list(stopping.map(lambda client: client.terminate(), clients))
            raise
        finally:
            pool.shutdown(wait=True, cancel_futures=True)
        finished_startup = round((clock() - started) * 1000)
        with concurrent.futures.ThreadPoolExecutor(max_workers=parallelism) as pool:
            probes = list(pool.map(lambda client: guest_disk_metrics(client, include_swap=True), clients))
        for index, probe in enumerate(probes):
            if probe["driver"] != expected_driver:
                raise RuntimeError("VM {} expected {} but reported {}".format(index + 1, expected_driver, probe["driver"]))
            metrics.append({"index": index + 1, "startupMs": ready[index], **probe})
    except (RuntimeError, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
        error = str(exc)
        with concurrent.futures.ThreadPoolExecutor(max_workers=parallelism) as stopping:
            list(stopping.map(lambda client: client.terminate(), clients))
    finally:
        with concurrent.futures.ThreadPoolExecutor(max_workers=parallelism) as pool:
            for future in [pool.submit(client.close) for client in clients]:
                try:
                    future.result()
                except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as exc:
                    error = error or f"VM cleanup failed: {exc}"
        try:
            item = sample(workspace, baseline_swap["used"], started, clock)
            item["phase"] = "post-close"
            samples.append(item)
        except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as exc:
            error = error or f"post-close host sample failed: {exc}"

    result = {
        "id": f"compose-{expected_driver}-{parallelism}vm-{stamp()}",
        "measuredAtUtc": started_at.isoformat(),
        "host": {"model": platform.node(), "cores": os.cpu_count(),
                 "memoryGiB": round(int(output("sysctl", "-n", "hw.memsize")) / 1024 ** 3)},
        "vm": {"vmm": vmm, "memoryGiB": memory_gib, "cpus": cpus,
               "guestSwapGiB": guest_swap_gib, "rootDiskGiB": 64, "storageDriver": expected_driver},
        "project": {"workspace": str(workspace), "composeFile": compose_file,
                    "workloadCommand": workload_command, "bootstrapCommand": bootstrap_command,
                    "composeWait": compose_wait, "imageCache": image_cache,
                    "guestEnvironmentKeys": sorted((guest_environment or {}).keys())},
        "parallelism": parallelism, "baseline": baseline,
        "readinessMs": ready, "wallClockMs": finished_startup,
        "totalElapsedMs": round((clock() - started) * 1000),
        "minFreeMemoryPercent": min((item["freeMemoryPercent"] for item in samples), default=baseline["freeMemoryPercent"]),
        "maxSwapGrowthMiB": max(0, *(item["swapGrowthMiB"] for item in samples)),
        "minFreeDiskGiB": min((item["freeDiskGiB"] for item in samples), default=baseline["freeDiskGiB"]),
        "limits": {"minFreeMemoryPercent": min_free_memory_percent,
                   "maxSwapGrowthMiB": max_swap_growth_mib, "minFreeDiskGiB": min_free_disk_gib},
        "samples": samples, "metrics": metrics,
        "allReady": error is None and len(metrics) == parallelism,
        "error": error, "checkpointsSaved": False,
    }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    parser.add_argument("--workspace", required=True)
    project = parser.add_mutually_exclusive_group(required=True)
    project.add_argument("--compose-file")
    project.add_argument("--workload-command-json")
    parser.add_argument("--bootstrap-command-json")
    parser.add_argument("--image-cache")
    parser.add_argument("--no-compose-wait", action="store_true")
    parser.add_argument("--expected-driver", choices=("vfs", "overlay2"), default="overlay2")
    parser.add_argument("--parallelism", type=int, choices=range(1, 9), default=2)
    parser.add_argument("--vm-memory-gib", type=int, default=6)
    parser.add_argument("--vm-cpus", type=int, default=2)
    parser.add_argument("--guest-swap-gib", type=int, default=0)
    parser.add_argument("--vmm", choices=("qemu", "krun"), default="qemu")
    parser.add_argument("--min-free-memory-percent", type=int, default=25)
    parser.add_argument("--max-swap-growth-mib", type=int, default=256)
    parser.add_argument("--min-free-disk-gib", type=int, default=30)
    args = parser.parse_args()
    result = measure(
        args.image, args.workspace, compose_file=args.compose_file,
        workload_command=json.loads(args.workload_command_json) if args.workload_command_json else None,
        bootstrap_command=json.loads(args.bootstrap_command_json) if args.bootstrap_command_json else None,
        guest_environment=json.loads(os.environ.get("GONDOLIN_BENCHMARK_GUEST_ENV_JSON", "{}")),
        compose_wait=not args.no_compose_wait, image_cache=args.image_cache,
        expected_driver=args.expected_driver, parallelism=args.parallelism,
        memory_gib=args.vm_memory_gib, cpus=args.vm_cpus, guest_swap_gib=args.guest_swap_gib,
        vmm=args.vmm, min_free_memory_percent=args.min_free_memory_percent,
        max_swap_growth_mib=args.max_swap_growth_mib, min_free_disk_gib=args.min_free_disk_gib)
    save(result)
    raise SystemExit(0 if result["allReady"] else 1)


if __name__ == "__main__":
    main()
