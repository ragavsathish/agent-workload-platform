"""Measure full-mock Compose startup and guest disk use for one Docker driver."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import time

from compose_common import DEFAULT_BOOTSTRAP, guest_disk_metrics, options
from results import save, stamp
from vm_client import VMClient


def measure(image, driver, workspace, *, compose_file=None, workload_command=None,
            bootstrap_command=None, compose_wait=True, image_cache=None, image_store=None,
            guest_environment=None,
            memory_gib=8, cpus=4, vmm="qemu", vm_factory=VMClient, clock=time.monotonic):
    client = vm_factory()
    started = clock()
    result = {"id": f"compose-storage-{driver}-{stamp()}",
              "driver": driver, "image": image, "startupMs": None,
              "project": {"workspace": str(workspace), "composeFile": compose_file,
                          "workloadCommand": workload_command,
                          "bootstrapCommand": bootstrap_command,
                          "composeWait": compose_wait, "imageCache": image_cache,
                          "imageStore": image_store,
                          "guestEnvironmentKeys": sorted((guest_environment or {}).keys())},
              "vm": {"memoryGiB": memory_gib, "cpus": cpus, "vmm": vmm},
              "probeExitCode": None, "metrics": {}, "error": None}
    try:
        client.start(options(image, workspace=workspace, compose_file=compose_file,
                             workload_command=workload_command,
                             bootstrap_command=bootstrap_command if bootstrap_command is not None else DEFAULT_BOOTSTRAP,
                             compose_wait=compose_wait, image_cache=image_cache,
                             image_store=image_store,
                             guest_environment=guest_environment or {},
                             label=f"compose-storage-benchmark-{driver}",
                             vmm=vmm, memory_gib=memory_gib, cpus=cpus))
        result["startupMs"] = round((clock() - started) * 1000)
        result["metrics"] = guest_disk_metrics(client)
        result["probeExitCode"] = 0
        if result["metrics"].get("driver") != driver:
            result["error"] = "guest storage probe failed or driver mismatched"
    except (RuntimeError, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
        result["error"] = str(exc)
    finally:
        try:
            client.close()
        except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as exc:
            result["error"] = result["error"] or f"VM cleanup failed: {exc}"
        result["totalElapsedMs"] = round((clock() - started) * 1000)
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
    parser.add_argument("--image-store")
    parser.add_argument("--no-compose-wait", action="store_true")
    parser.add_argument("--vm-memory-gib", type=int, default=8)
    parser.add_argument("--vm-cpus", type=int, default=4)
    parser.add_argument("--vmm", choices=("qemu", "krun"), default="qemu")
    parser.add_argument("--storage-driver", required=True, choices=("vfs", "overlay2"))
    args = parser.parse_args()
    result = measure(
        args.image, args.storage_driver, args.workspace,
        compose_file=args.compose_file,
        workload_command=json.loads(args.workload_command_json) if args.workload_command_json else None,
        bootstrap_command=json.loads(args.bootstrap_command_json) if args.bootstrap_command_json else None,
        guest_environment=json.loads(os.environ.get("GONDOLIN_BENCHMARK_GUEST_ENV_JSON", "{}")),
        compose_wait=not args.no_compose_wait, image_cache=args.image_cache,
        image_store=args.image_store,
        memory_gib=args.vm_memory_gib, cpus=args.vm_cpus, vmm=args.vmm)
    save(result)
    raise SystemExit(0 if result["error"] is None else 1)


if __name__ == "__main__":
    main()
