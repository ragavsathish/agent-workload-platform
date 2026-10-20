#!/usr/bin/env python3
"""Run independent Pi/Gondolin Patrol sessions and sample host headroom."""

import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from contextlib import nullcontext
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
IMAGE = os.environ.get("GONDOLIN_BENCHMARK_IMAGE", "agent-workload-platform/dev:v1-v2-1965d60792308dc9fc87017c99914c92")
METRICS = Path.home() / "Library/Application Support/PipecatEdge/gondolin-metrics"
EXTENSION = ROOT / "platform/agent-execution/gondolin-session/dist/pi-extension.js"
ASSETS = ROOT / "artifacts/gondolin-browser/aarch64"
PROMPT = (
    "Run exactly one bash tool command in the Gondolin VM, then report its exit status. "
    "Command: cd /workspace/products/voice-agent/apps/client && "
    "driver=$(docker info --format '{{.Driver}}') && echo storage-driver=$driver && "
    "test \"$driver\" = overlay2 && ip -br link && ip route && "
    "getent ahostsv4 registry.npmjs.org && "
    "npm ci --no-audit --no-fund --loglevel verbose; npm_status=$?; "
    "if [ \"$npm_status\" -ne 0 ]; then "
    "echo '--- npm debug log tail ---'; "
    "tail -n 120 \"$(find /root/.npm/_logs -name '*debug-0.log' -type f -print | sort | tail -1)\"; "
    "exit \"$npm_status\"; fi; "
    "npx playwright install chromium && npm run test:patrol. "
    "Do not modify source files or retry failures."
)


def command_output(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL).strip()


def swap_mib():
    output = command_output("sysctl", "vm.swapusage")
    return {name: float(value) for name, value in re.findall(r"(total|used|free) = ([\d.]+)M", output)}


def free_memory_percent():
    output = command_output("memory_pressure", "-Q")
    match = re.search(r"System-wide memory free percentage: (\d+)%", output)
    return int(match.group(1)) if match else None


def registered_rss(owner_pids):
    rss = 0
    for path in METRICS.glob("*.json"):
        try:
            entry = json.loads(path.read_text())
            if entry.get("ownerPid") not in owner_pids or entry.get("label") != "pi-dev-worktree":
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


def main(parallelism, max_swap_growth_mib, overlays, vm_memory="8G", vm_cpus=4,
         full_compose_mock=False, vm_vmm="krun"):
    revision = command_output("git", "-C", str(ROOT), "rev-parse", "HEAD")
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
    evidence_dir = ROOT / "artifacts/benchmarks" / f"patrol-concurrent-{parallelism}vm-{stamp}"
    memory_match = re.fullmatch(r"([1-9][0-9]*)G", vm_memory)
    if not memory_match or int(memory_match.group(1)) > 64:
        raise ValueError("VM memory must be a size from 1G through 64G")
    if not 1 <= vm_cpus <= 14:
        raise ValueError("VM CPUs must be between 1 and 14")
    baseline_memory = free_memory_percent()
    if baseline_memory is not None and baseline_memory < 25:
        raise RuntimeError(
            f"Not starting {parallelism} VMs: host free memory is {baseline_memory}%; "
            "the benchmark requires at least 25% at preflight."
        )
    baseline_swap = swap_mib()
    evidence_dir.mkdir(parents=True)
    baseline_disk = shutil.disk_usage("/System/Volumes/Data").free
    overlay_sources = []
    selected_overlays = list(overlays)
    if full_compose_mock:
        selected_overlays.extend([
            ".pi/hooks/start-dev-stack.mjs",
            ".pi/compose.full-mock.yml",
            ".pi/postgres-full-mock-init.sql.template",
            "products/voice-agent/apps/client/tool/patrol-mock-inference-broker.mjs",
        ])
    for name in dict.fromkeys(selected_overlays):
        source = (ROOT / name).resolve()
        if not source.is_relative_to(ROOT) or not source.is_file():
            raise ValueError(f"overlay must be a repository file: {name}")
        overlay_sources.append((source.relative_to(ROOT), source,
                                hashlib.sha256(source.read_bytes()).hexdigest()))
    runs = []
    samples = []
    stop_reason = None
    started = time.monotonic()
    workspace_dir = evidence_dir / "workspaces"
    workspace_dir.mkdir()
    # Keep mounted workspaces so a later Pi process can resume each saved guest disk.
    with nullcontext(workspace_dir) as temporary:
        for index in range(1, parallelism + 1):
            checkout = Path(temporary) / f"checkout-{index}"
            subprocess.run(["git", "clone", "--local", "--no-hardlinks", "--quiet", str(ROOT), str(checkout)], check=True)
            subprocess.run(["git", "-C", str(checkout), "checkout", "--quiet", revision], check=True)
            gondolin_config_path = checkout / ".pi/gondolin.json"
            gondolin_config = json.loads(gondolin_config_path.read_text())
            gondolin_config["memory"] = vm_memory
            gondolin_config["cpus"] = vm_cpus
            gondolin_config.setdefault("development", {})["vmm"] = vm_vmm
            if full_compose_mock:
                gondolin_config.setdefault("environment", {})["GONDOLIN_COMPOSE_PROFILE"] = "full-mock"
            gondolin_config_path.write_text(json.dumps(gondolin_config, indent=2) + "\n")
            for relative, source, _ in overlay_sources:
                destination = checkout / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
            log = evidence_dir / f"run-{index}.log"
            output = log.open("w")
            env = os.environ.copy()
            env.update({
                "GONDOLIN_EXECUTION_IMAGE_REF": IMAGE,
                "GONDOLIN_METRICS_DIR": str(METRICS),
                "GONDOLIN_DEV_ASSETS": str(ASSETS),
                "GONDOLIN_DEV_IMAGE_CACHE": str(ROOT / "artifacts/gondolin-dev-images/aarch64"),
            })
            session_dir = evidence_dir / f"run-{index}-pi-session"
            session_id = f"patrol-{stamp}-{index}"
            args = ["pi", "--print", "--mode", "json", "--session-id", session_id,
                    "--session-dir", str(session_dir), "--no-extensions", "--extension", str(EXTENSION),
                    "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-themes",
                    "--no-context-files", "--approve", PROMPT]
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
                disk = shutil.disk_usage("/System/Volumes/Data").free
                memory = free_memory_percent()
                rss = registered_rss({run["process"].pid for run in runs})
                sample = {"seconds": round(time.monotonic() - started, 1), "swapUsedMiB": swap["used"],
                          "swapFreeMiB": swap["free"], "diskFreeGiB": round(disk / 2**30, 2),
                          "hostFreeMemoryPercent": memory, "combinedVmRssBytes": rss}
                samples.append(sample)
                print(json.dumps(sample), flush=True)
                if swap["free"] < 256 or disk < 15 * 2**30 or (memory is not None and memory < 15):
                    stop_reason = "host headroom threshold reached"
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
                latest = run["checkout"] / "products/voice-agent/apps/client/build/patrol-latest"
                if latest.is_symlink():
                    source = latest.parent / "patrol-runs" / Path(os.readlink(latest)).name
                    destination = evidence_dir / f"run-{run['index']}-patrol"
                    if source.exists():
                        shutil.copytree(source, destination, symlinks=True)
    final_swap = swap_mib()
    result = {
        "id": f"mac-m4-pro-{stamp}-patrol-web-{parallelism}vm",
        "measuredAtUtc": stamp,
        "commit": revision,
        "overlays": [{"path": str(relative), "sha256": digest}
                     for relative, _, digest in overlay_sources],
        "host": {"model": "Mac mini M4 Pro", "cores": 14, "memoryGiB": 64, "macos": "26.6.2"},
        "vm": {"memoryGiB": int(memory_match.group(1)), "cpus": vm_cpus,
               "image": IMAGE, "vmm": vm_vmm},
        "parallelism": parallelism,
        "baselineSwapUsedMiB": baseline_swap["used"],
        "baselineDiskFreeGiB": round(baseline_disk / 2**30, 2),
        "swapGrowthMiB": round(final_swap["used"] - baseline_swap["used"], 2),
        "peakCombinedVmRssBytes": max((sample["combinedVmRssBytes"] for sample in samples), default=0),
        "minHostFreeMemoryPercent": min((sample["hostFreeMemoryPercent"] for sample in samples if sample["hostFreeMemoryPercent"] is not None), default=None),
        "minFreeDiskGiB": min((sample["diskFreeGiB"] for sample in samples), default=None),
        "stopReason": stop_reason,
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
    print(f"RESULT {result_path}", flush=True)
    return 1 if stop_reason or any(run["process"].returncode or command_exit_code(run["log"]) != 0 for run in runs) else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--parallelism", type=int, choices=range(1, 9), default=2,
                        help="Number of independent VMs to start (1-8)")
    parser.add_argument("--max-swap-growth-mib", type=int, default=4096)
    parser.add_argument("--vm-memory", default="8G", help="Guest RAM per VM (default: 8G)")
    parser.add_argument("--vm-cpus", type=int, default=4, help="Guest vCPUs per VM (default: 4)")
    parser.add_argument("--vmm", choices=("qemu", "krun"), default="krun",
                        help="VM monitor backend (default: krun)")
    parser.add_argument("--full-compose-mock", action="store_true",
                        help="Run the full local Compose stack with mocked inference and tailnet ingress")
    parser.add_argument("--overlay", action="append", default=[],
                        help="Repository-relative working-tree file copied into each pinned checkout")
    args = parser.parse_args()
    sys.exit(main(args.parallelism, args.max_swap_growth_mib, args.overlay,
                  args.vm_memory, args.vm_cpus, args.full_compose_mock, args.vmm))
