"""Measure concurrent Compose VM readiness, optional journeys, and host headroom."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import platform
import shutil
import subprocess
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path

from compose_common import DEFAULT_BOOTSTRAP, guest_disk_metrics, options
from host_metrics import free_disk_gib, free_memory_percent, output, sample, swap_mib
from results import save, stamp
from vm_client import VMClient

ROOT = Path(__file__).resolve().parents[4]
ORACLE_TOOL = "platform/agent-execution/gondolin-session/tools/oracle.clj"


def _monitor(futures, *, phase, samples, workspace, baseline_swap, started, clock,
             min_free_memory_percent, max_swap_growth_mib, min_free_disk_gib,
             phase_timeout_seconds=None):
    completed_results = {}
    phase_started = clock()
    while futures:
        completed, _ = concurrent.futures.wait(
            futures, timeout=1, return_when=concurrent.futures.FIRST_COMPLETED)
        item = sample(workspace, baseline_swap, started, clock)
        item["phase"] = phase
        samples.append(item)
        for future in completed:
            index = futures.pop(future)
            completed_results[index] = (future.result(), round((clock() - started) * 1000))
        if item["freeMemoryPercent"] < min_free_memory_percent:
            raise RuntimeError("host free memory crossed the configured floor")
        if item["swapGrowthMiB"] > max_swap_growth_mib:
            raise RuntimeError("host swap growth crossed the configured ceiling")
        if item["freeDiskGiB"] < min_free_disk_gib:
            raise RuntimeError("host free disk crossed the configured floor")
        if phase_timeout_seconds is not None and clock() - phase_started > phase_timeout_seconds:
            raise RuntimeError(f"{phase} exceeded {phase_timeout_seconds} seconds")
    return completed_results


def _isolated_workspaces(workspace, count, overlays, directory):
    revision = subprocess.check_output(["git", "-C", str(workspace), "rev-parse", "HEAD"], text=True).strip()
    checkouts = []
    for index in range(count):
        checkout = directory / f"checkout-{index + 1}"
        subprocess.run(["git", "clone", "--local", "--no-hardlinks", "--quiet",
                        str(workspace), str(checkout)], check=True)
        subprocess.run(["git", "-C", str(checkout), "checkout", "--quiet", revision], check=True)
        for relative in overlays:
            relative_path = Path(relative)
            if relative_path.is_absolute() or ".." in relative_path.parts:
                raise ValueError(f"workspace overlay must be a relative project file: {relative}")
            source = (workspace / relative).resolve()
            if not source.is_relative_to(workspace) or not source.is_file():
                raise ValueError(f"workspace overlay is not a project file: {relative}")
            target = checkout / relative_path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        # Compose validates this production env_file even when voice-edge is inactive.
        edge_env = checkout / "products/voice-agent/apps/edge/.env"
        edge_env.parent.mkdir(parents=True, exist_ok=True)
        edge_env.touch(exist_ok=True)
        checkouts.append(checkout)
    return checkouts, revision


def measure(image, workspace, *, compose_file=None, workload_command=None,
            bootstrap_command=None, compose_wait=True, image_cache=None, image_store=None,
            guest_environment=None, patrol_command=None, patrol_oracle=False, workspace_overlays=None,
            patrol_timeout_seconds=360,
            expected_driver="overlay2", parallelism=2, memory_gib=6, cpus=2,
            guest_swap_gib=0, vmm="qemu", min_free_memory_percent=25,
            max_swap_growth_mib=256, min_free_disk_gib=30,
            vm_factory=VMClient, clock=time.monotonic):
    workspace = Path(workspace).resolve()
    if patrol_command is not None and (not isinstance(patrol_command, list) or not patrol_command
                                       or any(not isinstance(part, str) or not part for part in patrol_command)):
        raise ValueError("patrol_command must be a nonempty argument vector")
    if patrol_oracle and not patrol_command:
        raise ValueError("patrol_oracle requires patrol_command")
    if patrol_timeout_seconds <= 0:
        raise ValueError("patrol_timeout_seconds must be positive")
    workspace_overlays = list(workspace_overlays or [])
    if patrol_oracle and ORACLE_TOOL not in workspace_overlays:
        workspace_overlays.append(ORACLE_TOOL)
    overlay_checksums = {
        relative: hashlib.sha256((workspace / relative).read_bytes()).hexdigest()
        for relative in workspace_overlays
        if not Path(relative).is_absolute() and ".." not in Path(relative).parts
        and (workspace / relative).is_file()
    }
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
    result_id = f"compose-{expected_driver}-{parallelism}vm-{stamp()}"
    evidence_dir = ROOT / "artifacts" / "benchmarks" / "patrol-evidence" / result_id
    if patrol_command:
        evidence_dir.mkdir(parents=True, mode=0o700)
        os.chmod(evidence_dir, 0o700)
    temporary = Path(tempfile.mkdtemp(prefix="compose-patrol-")) if patrol_command else None
    try:
        checkouts, revision = (_isolated_workspaces(workspace, parallelism, workspace_overlays, temporary)
                               if temporary else ([workspace] * parallelism, None))
    except Exception:
        if temporary:
            shutil.rmtree(temporary, ignore_errors=True)
        raise
    started_at = datetime.now(UTC)
    started = clock()
    clients = [vm_factory() for _ in range(parallelism)]
    ready = [None] * parallelism
    patrol_duration = [None] * parallelism
    patrol_exit_codes = [None] * parallelism
    patrol_evidence = [None] * parallelism
    patrol_oracle_results = [None] * parallelism
    samples = []
    metrics = []
    error = None
    finished_startup = None
    finished_patrol = None
    try:
        def start_client(index, client):
            config = options(
                image, workspace=checkouts[index], compose_file=compose_file,
                workload_command=workload_command,
                bootstrap_command=bootstrap_command if bootstrap_command is not None else DEFAULT_BOOTSTRAP,
                compose_wait=compose_wait, image_cache=image_cache, image_store=image_store,
                guest_environment=guest_environment or {},
                label=f"compose-parallel-{expected_driver}-{index + 1}",
                vmm=vmm, memory_gib=memory_gib, cpus=cpus,
                guest_swap_gib=guest_swap_gib)
            if patrol_command:
                destination = evidence_dir / f"run-{index + 1}-patrol"
                destination.mkdir(mode=0o700)
                config["mounts"]["/benchmark-evidence"] = str(destination)
            return client.start(config)

        pool = concurrent.futures.ThreadPoolExecutor(max_workers=parallelism)
        try:
            futures = {
                pool.submit(start_client, index, client): index
                for index, client in enumerate(clients)
            }
            for index, (_, finished) in _monitor(
                futures, phase="startup", samples=samples, workspace=workspace,
                baseline_swap=baseline_swap["used"], started=started, clock=clock,
                min_free_memory_percent=min_free_memory_percent,
                max_swap_growth_mib=max_swap_growth_mib,
                min_free_disk_gib=min_free_disk_gib).items():
                ready[index] = finished
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
        if patrol_command:
            patrol_started = clock()
            pool = concurrent.futures.ThreadPoolExecutor(max_workers=parallelism)
            try:
                futures = {pool.submit(client.run, patrol_command): index
                           for index, client in enumerate(clients)}
                completed = _monitor(
                    futures, phase="patrol", samples=samples, workspace=workspace,
                    baseline_swap=baseline_swap["used"], started=started, clock=clock,
                    min_free_memory_percent=min_free_memory_percent,
                    max_swap_growth_mib=max_swap_growth_mib,
                    min_free_disk_gib=min_free_disk_gib,
                    phase_timeout_seconds=patrol_timeout_seconds)
                verification_errors = []
                for index, (execution, finished) in completed.items():
                    patrol_duration[index] = finished - round((patrol_started - started) * 1000)
                    patrol_exit_codes[index] = execution.get("exitCode")
                    log = evidence_dir / f"run-{index + 1}-patrol.log"
                    log.write_text((execution.get("stdout") or "") + "\n" + (execution.get("stderr") or ""))
                    os.chmod(log, 0o600)
                    guest_evidence = clients[index].run([
                        "cat", "/workspace/products/voice-agent/apps/client/build/patrol-trace-evidence.json"])
                    if guest_evidence.get("exitCode") == 0:
                        evidence_file = evidence_dir / f"run-{index + 1}-trace-evidence.json"
                        evidence_file.write_text(guest_evidence.get("stdout") or "")
                        os.chmod(evidence_file, 0o600)
                    capture = clients[index].run([
                        "/bin/sh", "-c",
                        ("source=$(readlink -f /workspace/products/voice-agent/apps/client/build/patrol-latest) "
                         "&& test -d \"$source\" && cp -a \"$source\"/. /benchmark-evidence/"),
                    ])
                    if capture.get("exitCode") == 0:
                        patrol_evidence[index] = str(evidence_dir / f"run-{index + 1}-patrol")
                    else:
                        verification_errors.append(f"VM {index + 1}: trace capture failed: {capture.get('stderr')}")
                    if patrol_oracle and execution.get("exitCode") == 0:
                        try:
                            oracle_execution = clients[index].run([
                                "/usr/local/bin/bb", f"/workspace/{ORACLE_TOOL}",
                                "/workspace/products/voice-agent/apps/client/build/patrol-latest",
                                result_id, str(index + 1),
                            ])
                            oracle_result = json.loads(oracle_execution.get("stdout") or "{}")
                            if not isinstance(oracle_result, dict) or not isinstance(oracle_result.get("passed"), bool):
                                raise TypeError("oracle did not return a JSON verdict")
                            if (oracle_execution.get("exitCode") == 0) != oracle_result["passed"]:
                                raise ValueError("oracle exit code and JSON verdict disagree")
                        except (OSError, ValueError, TypeError, KeyError) as exc:
                            oracle_result = {"passed": False, "failures": [f"oracle execution failed: {exc}"]}
                        patrol_oracle_results[index] = oracle_result
                        oracle_file = evidence_dir / f"run-{index + 1}-oracle.json"
                        oracle_file.write_text(json.dumps(oracle_result, indent=2) + "\n")
                        os.chmod(oracle_file, 0o600)
                        if not oracle_result["passed"]:
                            verification_errors.append(f"VM {index + 1}: Patrol oracle failed")
                finished_patrol = round((clock() - started) * 1000)
                if verification_errors:
                    raise RuntimeError("Patrol verification failed: " + "; ".join(verification_errors))
                failed = [index + 1 for index, status in enumerate(patrol_exit_codes) if status != 0]
                if failed:
                    raise RuntimeError(f"Patrol failed in VMs {failed}")
            except Exception:
                with concurrent.futures.ThreadPoolExecutor(max_workers=parallelism) as stopping:
                    list(stopping.map(lambda client: client.terminate(), clients))
                raise
            finally:
                pool.shutdown(wait=True, cancel_futures=True)
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
        if temporary:
            shutil.rmtree(temporary, ignore_errors=True)

    result = {
        "id": result_id,
        "measuredAtUtc": started_at.isoformat(),
        "host": {"model": platform.node(), "cores": os.cpu_count(),
                 "memoryGiB": round(int(output("sysctl", "-n", "hw.memsize")) / 1024 ** 3)},
        "vm": {"vmm": vmm, "memoryGiB": memory_gib, "cpus": cpus,
               "guestSwapGiB": guest_swap_gib, "rootDiskGiB": 64, "storageDriver": expected_driver},
        "project": {"workspace": str(workspace), "composeFile": compose_file,
                    "workloadCommand": workload_command, "bootstrapCommand": bootstrap_command,
                    "composeWait": compose_wait, "imageCache": image_cache,
                    "imageStore": image_store,
                    "patrolCommand": patrol_command, "patrolOracleEnabled": patrol_oracle,
                    "patrolTimeoutSeconds": patrol_timeout_seconds,
                    "workspaceOverlays": workspace_overlays,
                    "workspaceOverlaySha256": overlay_checksums,
                    "sourceRevision": revision,
                    "guestEnvironmentKeys": sorted((guest_environment or {}).keys())},
        "parallelism": parallelism, "baseline": baseline,
        "readinessMs": ready, "wallClockMs": finished_startup,
        "patrolDurationMs": patrol_duration, "patrolExitCodes": patrol_exit_codes,
        "patrolEvidence": patrol_evidence, "patrolWallClockMs": finished_patrol,
        "patrolOracle": patrol_oracle_results,
        "totalElapsedMs": round((clock() - started) * 1000),
        "minFreeMemoryPercent": min((item["freeMemoryPercent"] for item in samples), default=baseline["freeMemoryPercent"]),
        "maxSwapGrowthMiB": max(0, *(item["swapGrowthMiB"] for item in samples)),
        "minFreeDiskGiB": min((item["freeDiskGiB"] for item in samples), default=baseline["freeDiskGiB"]),
        "limits": {"minFreeMemoryPercent": min_free_memory_percent,
                   "maxSwapGrowthMiB": max_swap_growth_mib, "minFreeDiskGiB": min_free_disk_gib},
        "samples": samples, "metrics": metrics,
        "allReady": all(value is not None for value in ready),
        "allPassed": error is None and len(metrics) == parallelism
                     and all(value is not None for value in ready)
                     and (patrol_command is None or all(value == 0 for value in patrol_exit_codes))
                     and (not patrol_oracle or all(item and item.get("passed") for item in patrol_oracle_results)),
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
    parser.add_argument("--image-store")
    parser.add_argument("--patrol-command-json")
    parser.add_argument("--patrol-oracle", action="store_true")
    parser.add_argument("--patrol-timeout-seconds", type=int, default=360)
    parser.add_argument("--workspace-overlay", action="append", default=[])
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
        image_store=args.image_store,
        patrol_command=json.loads(args.patrol_command_json) if args.patrol_command_json else None,
        patrol_oracle=args.patrol_oracle,
        patrol_timeout_seconds=args.patrol_timeout_seconds,
        workspace_overlays=args.workspace_overlay,
        expected_driver=args.expected_driver, parallelism=args.parallelism,
        memory_gib=args.vm_memory_gib, cpus=args.vm_cpus, guest_swap_gib=args.guest_swap_gib,
        vmm=args.vmm, min_free_memory_percent=args.min_free_memory_percent,
        max_swap_growth_mib=args.max_swap_growth_mib, min_free_disk_gib=args.min_free_disk_gib)
    save(result)
    raise SystemExit(0 if result["allPassed"] else 1)


if __name__ == "__main__":
    main()
