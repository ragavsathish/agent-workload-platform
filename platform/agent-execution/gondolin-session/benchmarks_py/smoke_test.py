"""Run independent Pi/Gondolin VM smoke tests and sample host headroom."""

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import signal
import subprocess
import sys
import time
from contextlib import nullcontext
from datetime import UTC, datetime
from pathlib import Path

from host_metrics import free_memory_percent, swap_mib
from task_checkpoint import dispose

ROOT = Path(__file__).resolve().parents[4]
DEFAULT_PROMPT = Path(__file__).with_name("prompts") / "vm_smoke_test.md"
DEFAULT_EXTENSION = ROOT / "platform/agent-execution/gondolin-session/dist/pi-extension.js"
DEFAULT_METRICS = Path.home() / "Library/Application Support/PipecatEdge/gondolin-metrics"


def command_output(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL).strip()


def registered_rss(owner_pids, metrics_dir, session_label):
    rss = 0
    for path in metrics_dir.glob("*.json"):
        try:
            entry = json.loads(path.read_text())
            if entry.get("ownerPid") not in owner_pids or entry.get("label") != session_label:
                continue
            value = command_output("ps", "-o", "rss=", "-p", str(entry["pid"]))
            rss += int(value) * 1024 if value else 0
        except (OSError, ValueError, subprocess.CalledProcessError, KeyError):
            pass
    return rss


def command_exit_code(log):
    for line in log.read_text().splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "tool_execution_end" and event.get("toolName") == "bash":
            return event.get("result", {}).get("structuredContent", {}).get("exit_code")
    return None


def main(*, workspace, image, prompt_file, config_path, extension, assets,
         image_cache, metrics_dir, session_label, capture_path, guest_environment,
         parallelism, max_swap_growth_mib, min_free_memory_percent, min_free_disk_gib,
         min_free_swap_mib, overlays, vm_memory="8G", vm_cpus=4,
         vm_vmm="qemu", retain_checkpoints=False):
    workspace = Path(workspace).resolve()
    prompt_file = Path(prompt_file).resolve()
    extension = Path(extension).resolve()
    metrics_dir = Path(metrics_dir).resolve()
    if not workspace.is_dir() or not (workspace / ".git").exists():
        raise ValueError("workspace must be a Git checkout")
    if not prompt_file.is_file() or not extension.is_file():
        raise ValueError("prompt_file and extension must be readable files")
    config_source = (workspace / config_path).resolve()
    if not config_source.is_relative_to(workspace) or not config_source.is_file():
        raise ValueError("config_path must be a file inside workspace")
    prompt = prompt_file.read_text(encoding="utf-8").strip()
    if not prompt:
        raise ValueError("prompt_file is empty")
    revision = command_output("git", "-C", str(workspace), "rev-parse", "HEAD")
    stamp = datetime.now(UTC).strftime("%Y-%m-%dT%H%M%SZ")
    evidence_dir = ROOT / "artifacts/benchmarks" / f"smoke-test-{parallelism}vm-{stamp}"
    memory_match = re.fullmatch(r"([1-9][0-9]*)G", vm_memory)
    if not memory_match or int(memory_match.group(1)) > 64:
        raise ValueError("VM memory must be a size from 1G through 64G")
    if not 1 <= vm_cpus <= 14:
        raise ValueError("VM CPUs must be between 1 and 14")
    baseline_memory = free_memory_percent()
    if baseline_memory is not None and baseline_memory < min_free_memory_percent:
        raise RuntimeError(
            f"Not starting {parallelism} VMs: host free memory is {baseline_memory}%; "
            f"the benchmark requires at least {min_free_memory_percent}% at preflight."
        )
    baseline_swap = swap_mib()
    if baseline_swap["free"] < min_free_swap_mib:
        raise RuntimeError(
            f"Not starting {parallelism} VMs: host free swap is {baseline_swap['free']:.0f} MiB; "
            f"the benchmark requires at least {min_free_swap_mib} MiB at preflight."
        )
    baseline_disk = shutil.disk_usage(ROOT).free
    if baseline_disk < min_free_disk_gib * 2**30:
        raise RuntimeError(
            f"Not starting {parallelism} VMs: host free disk is {baseline_disk / 2**30:.2f} GiB; "
            f"the benchmark requires at least {min_free_disk_gib} GiB at preflight."
        )
    evidence_dir.mkdir(parents=True, mode=0o700)
    os.chmod(evidence_dir, 0o700)
    overlay_sources = []
    for name in dict.fromkeys(overlays):
        source = (workspace / name).resolve()
        if not source.is_relative_to(workspace) or not source.is_file():
            raise ValueError(f"overlay must be a project file: {name}")
        overlay_sources.append((source.relative_to(workspace), source,
                                hashlib.sha256(source.read_bytes()).hexdigest()))
    runs = []
    samples = []
    stop_reason = None
    started = time.monotonic()
    workspace_dir = evidence_dir / "workspaces"
    workspace_dir.mkdir()
    with nullcontext(workspace_dir) as temporary:
        for index in range(1, parallelism + 1):
            checkout = Path(temporary) / f"checkout-{index}"
            subprocess.run(["git", "clone", "--local", "--no-hardlinks", "--quiet", str(workspace), str(checkout)], check=True)
            subprocess.run(["git", "-C", str(checkout), "checkout", "--quiet", revision], check=True)
            gondolin_config_path = checkout / config_source.relative_to(workspace)
            gondolin_config = json.loads(gondolin_config_path.read_text())
            gondolin_config["memory"] = vm_memory
            gondolin_config["cpus"] = vm_cpus
            gondolin_config.setdefault("development", {})["vmm"] = vm_vmm
            gondolin_config.setdefault("environment", {}).update(guest_environment)
            gondolin_config_path.write_text(json.dumps(gondolin_config, indent=2) + "\n")
            for relative, source, _ in overlay_sources:
                destination = checkout / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
            log = evidence_dir / f"run-{index}.log"
            output = log.open("w")
            os.chmod(log, 0o600)
            env = os.environ.copy()
            env.update({
                "GONDOLIN_EXECUTION_IMAGE_REF": image,
                "GONDOLIN_METRICS_DIR": str(metrics_dir),
            })
            if assets:
                env["GONDOLIN_DEV_ASSETS"] = str(Path(assets).resolve())
            if image_cache:
                env["GONDOLIN_DEV_IMAGE_CACHE"] = str(Path(image_cache).resolve())
            session_dir = evidence_dir / f"run-{index}-pi-session"
            session_id = f"vm-smoke-{stamp}-{index}"
            args = ["pi", "--print", "--mode", "json", "--session-id", session_id,
                    "--session-dir", str(session_dir), "--no-extensions", "--extension", str(extension),
                    "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-themes",
                    "--no-context-files", "--approve", prompt]
            process = subprocess.Popen(args, cwd=checkout, env=env, stdout=output, stderr=subprocess.STDOUT,
                                       start_new_session=True)
            runs.append({"index": index, "checkout": checkout, "process": process, "output": output,
                         "log": log, "session_dir": session_dir, "session_id": session_id,
                         "started": time.monotonic(), "ended": None})
        try:
            while True:
                for run in runs:
                    if run["process"].poll() is not None and run["ended"] is None:
                        run["ended"] = time.monotonic()
                if all(run["ended"] is not None for run in runs):
                    break
                swap = swap_mib()
                disk = shutil.disk_usage(ROOT).free
                memory = free_memory_percent()
                rss = registered_rss({run["process"].pid for run in runs}, metrics_dir, session_label)
                sample = {"seconds": round(time.monotonic() - started, 1), "swapUsedMiB": swap["used"],
                          "swapFreeMiB": swap["free"], "diskFreeGiB": round(disk / 2**30, 2),
                          "hostFreeMemoryPercent": memory, "combinedVmRssBytes": rss}
                samples.append(sample)
                print(json.dumps(sample), flush=True)
                if swap["free"] < min_free_swap_mib or disk < min_free_disk_gib * 2**30 or (
                    memory is not None and memory < min_free_memory_percent
                ):
                    stop_reason = (
                        "host headroom threshold reached "
                        f"(memory<{min_free_memory_percent}%, disk<{min_free_disk_gib}GiB, "
                        f"free swap<{min_free_swap_mib}MiB)"
                    )
                    break
                if swap["used"] - baseline_swap["used"] > max_swap_growth_mib:
                    stop_reason = f"swap growth exceeded {max_swap_growth_mib} MiB"
                    break
                time.sleep(1)
        finally:
            if stop_reason:
                for run in runs:
                    if run["process"].poll() is None:
                        os.killpg(run["process"].pid, signal.SIGINT)
            for run in runs:
                try:
                    run["process"].wait(timeout=30)
                except subprocess.TimeoutExpired:
                    os.killpg(run["process"].pid, signal.SIGKILL)
                    run["process"].wait()
                run["output"].close()
                if capture_path:
                    latest = (run["checkout"] / capture_path).resolve()
                    if latest.is_relative_to(run["checkout"]) and latest.is_dir():
                        destination = evidence_dir / f"run-{run['index']}-capture"
                        shutil.copytree(latest, destination, symlinks=True)
                session_file = next(run["session_dir"].glob("*.jsonl"), None)
                if session_file is not None and not retain_checkpoints:
                    try:
                        dispose(session_file)
                    except (OSError, ValueError, RuntimeError) as error:
                        stop_reason = stop_reason or f"benchmark VM {run['index']} disposal failed"
                        print(str(error), file=sys.stderr, flush=True)
    final_swap = swap_mib()
    result = {
        "id": f"vm-smoke-test-{parallelism}vm-{stamp}",
        "measuredAtUtc": stamp,
        "commit": revision,
        "sourceWorkspace": str(workspace),
        "promptFile": str(prompt_file),
        "promptSha256": hashlib.sha256(prompt.encode()).hexdigest(),
        "configPath": str(config_source.relative_to(workspace)),
        "capturePath": capture_path,
        "guestEnvironmentKeys": sorted(guest_environment),
        "overlays": [{"path": str(relative), "sha256": digest}
                     for relative, _, digest in overlay_sources],
        "host": {"model": platform.node(), "cores": os.cpu_count(),
                 "memoryGiB": round(int(command_output("sysctl", "-n", "hw.memsize")) / 2**30),
                 "macos": platform.mac_ver()[0]},
        "vm": {"memoryGiB": int(memory_match.group(1)), "cpus": vm_cpus,
               "image": image, "vmm": vm_vmm},
        "parallelism": parallelism,
        "guardrails": {"minFreeMemoryPercent": min_free_memory_percent,
                       "maxSwapGrowthMiB": max_swap_growth_mib,
                       "minFreeSwapMiB": min_free_swap_mib,
                       "minFreeDiskGiB": min_free_disk_gib},
        "baselineSwapUsedMiB": baseline_swap["used"],
        "baselineDiskFreeGiB": round(baseline_disk / 2**30, 2),
        "swapGrowthMiB": round(final_swap["used"] - baseline_swap["used"], 2),
        "peakCombinedVmRssBytes": max((sample["combinedVmRssBytes"] for sample in samples), default=0),
        "minHostFreeMemoryPercent": min((sample["hostFreeMemoryPercent"] for sample in samples if sample["hostFreeMemoryPercent"] is not None), default=None),
        "minFreeDiskGiB": min((sample["diskFreeGiB"] for sample in samples), default=None),
        "stopReason": stop_reason,
        "checkpointsRetained": retain_checkpoints,
        "runs": [{"index": run["index"], "piExitCode": run["process"].returncode,
                  "commandExitCode": command_exit_code(run["log"]),
                  "durationSeconds": round((run["ended"] or time.monotonic()) - run["started"], 2),
                  "workspace": str(run["checkout"].relative_to(ROOT)),
                  "sessionId": run["session_id"],
                  "sessionFile": next((str(file.relative_to(ROOT)) for file in run["session_dir"].glob("*.jsonl")), None),
                  "log": str(run["log"].relative_to(ROOT))} for run in runs],
        "samples": samples,
    }
    result_path = evidence_dir / "result.json"
    result_path.write_text(json.dumps(result, indent=2) + "\n")
    os.chmod(result_path, 0o600)
    print(f"RESULT {result_path}", flush=True)
    return 1 if stop_reason or any(run["process"].returncode or command_exit_code(run["log"]) != 0 for run in runs) else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--prompt-file", type=Path, default=DEFAULT_PROMPT)
    parser.add_argument("--config-path", default=".pi/gondolin.json")
    parser.add_argument("--extension", type=Path, default=DEFAULT_EXTENSION)
    parser.add_argument("--assets", type=Path)
    parser.add_argument("--image-cache", type=Path)
    parser.add_argument("--metrics-dir", type=Path, default=DEFAULT_METRICS)
    parser.add_argument("--session-label", default="pi-dev-worktree")
    parser.add_argument("--capture-path")
    parser.add_argument("--parallelism", type=int, choices=range(1, 9), default=2,
                        help="Number of independent VMs to start (1-8)")
    parser.add_argument("--max-swap-growth-mib", type=int, default=128)
    parser.add_argument("--min-free-memory-percent", type=int, default=40,
                        help="Abort below this percentage of free host memory")
    parser.add_argument("--min-free-disk-gib", type=int, default=100,
                        help="Require this much free host disk")
    parser.add_argument("--min-free-swap-mib", type=int, default=256,
                        help="Require this much free host swap")
    parser.add_argument("--vm-memory", default="8G", help="Guest RAM per VM (default: 8G)")
    parser.add_argument("--vm-cpus", type=int, default=4, help="Guest vCPUs per VM (default: 4)")
    parser.add_argument("--vmm", choices=("qemu", "krun"), default="qemu",
                        help="VM monitor backend (default: qemu)")
    parser.add_argument("--overlay", action="append", default=[],
                        help="Project-relative working-tree file copied into each pinned checkout")
    parser.add_argument("--retain-checkpoints", action="store_true",
                        help="Keep saved task VM disks for a later lifecycle measurement")
    args = parser.parse_args()
    sys.exit(main(
        workspace=args.workspace, image=args.image, prompt_file=args.prompt_file,
        config_path=args.config_path, extension=args.extension, assets=args.assets,
        image_cache=args.image_cache, metrics_dir=args.metrics_dir,
        session_label=args.session_label, capture_path=args.capture_path,
        guest_environment=json.loads(os.environ.get("GONDOLIN_BENCHMARK_GUEST_ENV_JSON", "{}")),
        parallelism=args.parallelism, max_swap_growth_mib=args.max_swap_growth_mib,
        min_free_memory_percent=args.min_free_memory_percent,
        min_free_disk_gib=args.min_free_disk_gib, min_free_swap_mib=args.min_free_swap_mib,
        overlays=args.overlay, vm_memory=args.vm_memory, vm_cpus=args.vm_cpus,
        vm_vmm=args.vmm, retain_checkpoints=args.retain_checkpoints))
