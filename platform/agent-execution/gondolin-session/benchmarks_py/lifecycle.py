"""Measure Gondolin VM cold start, resume, and checkpoint costs."""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
import time
from pathlib import Path

from host_metrics import swap_mib
from results import ROOT, save, stamp
from vm_client import VMClient


def disk(path: Path):
    info = json.loads(subprocess.check_output(
        ["qemu-img", "info", "--output=json", str(path)], text=True))
    stat = path.stat()
    return {"fileBytes": stat.st_size, "allocatedBytes": stat.st_blocks * 512,
            "virtualBytes": info["virtual-size"], "format": info["format"]}


def directory_bytes(path: Path):
    return int(subprocess.check_output(["du", "-sk", str(path)], text=True).split()[0]) * 1024


def vm_options(image, workspace, checkpoint=None, vmm="qemu", memory_gib=8, cpus=4):
    return {
        "imagePath": image,
        "mounts": {"/workspace": str(workspace)},
        "network": {"allowedHosts": ["*"]},
        "sandbox": {"vmm": vmm},
        "memory": f"{memory_gib}G", "cpus": cpus,
        "rootfs": {"mode": "cow", "size": "64G"},
        "maxHttpResponseBodyBytes": 512 * 1024 * 1024,
        "sessionLabel": "vm-smoke-test-lifecycle",
        "resumeCheckpointPath": str(checkpoint) if checkpoint else None,
    }


def trial(kind, image, workspace, checkpoint=None, save_checkpoint=None,
          vmm="qemu", memory_gib=8, cpus=4,
          vm_factory=VMClient, clock=time.monotonic):
    client = vm_factory()
    swap_before = swap_mib()["used"]
    started = clock()
    try:
        client.start(vm_options(image, workspace, checkpoint, vmm, memory_gib, cpus))
        ready = clock()
        probe = client.run(["/bin/true"])
        command_done = clock()
        if probe.get("exitCode") != 0:
            raise RuntimeError("guest probe exited with {}".format(probe.get("exitCode")))
        checkpoint_ms = None
        saved_disk = None
        if save_checkpoint:
            before_save = clock()
            client.checkpoint(save_checkpoint)
            checkpoint_ms = round((clock() - before_save) * 1000)
            saved_disk = disk(save_checkpoint)
        return {
            "kind": kind,
            "checkpoint": str(checkpoint) if checkpoint else None,
            "startupMs": round((ready - started) * 1000),
            "firstCommandMs": round((command_done - ready) * 1000),
            "checkpointMs": checkpoint_ms,
            "savedDisk": saved_disk,
            "swapGrowthMiB": round(swap_mib()["used"] - swap_before, 2),
        }
    finally:
        client.close()


def median(values):
    ordered = sorted(values)
    return ordered[len(ordered) // 2]


def measure(source: Path, vm_factory=VMClient):
    prior = json.loads(source.read_text(encoding="utf-8"))
    if not prior.get("runs"):
        raise ValueError("smoke test result has no runs")
    image = prior["vm"]["image"]
    vmm = prior["vm"].get("vmm", "qemu")
    memory_gib = prior["vm"]["memoryGiB"]
    cpus = prior["vm"]["cpus"]
    runs = prior["runs"]
    result = {
        "id": f"vm-lifecycle-{stamp()}", "host": prior["host"],
        "vm": {**prior["vm"], "diskLimitGiB": 64},
        "source": str(source),
        "method": "Sequential Gondolin boot, /bin/true, and checkpoint; excludes project startup and Pi execution",
        "retained": [], "trials": [], "completed": False, "error": None,
    }
    for run in runs:
        workspace = ROOT / run["workspace"]
        checkpoint = Path(str(ROOT / run["sessionFile"]) + ".gondolin.qcow2")
        result["retained"].append({
            "index": run["index"], "smokeTestExitCode": run["commandExitCode"],
            "workspace": run["workspace"], "workspaceBytes": directory_bytes(workspace),
            "checkpoint": str(checkpoint.relative_to(ROOT)), "checkpointDisk": disk(checkpoint),
        })
    with tempfile.TemporaryDirectory(prefix="gondolin-lifecycle-bench-") as scratch:
        cold_disk = Path(scratch) / "cold.qcow2"
        warm_disk = Path(scratch) / "warm.qcow2"
        try:
            workspace = ROOT / runs[0]["workspace"]
            for index in range(3):
                result["trials"].append(trial("cold", image, workspace,
                                               save_checkpoint=cold_disk if index == 0 else None,
                                               vmm=vmm, memory_gib=memory_gib, cpus=cpus,
                                               vm_factory=vm_factory))
            result["trials"].append(trial("fresh-checkpoint-resume", image, workspace,
                                           checkpoint=cold_disk, vmm=vmm,
                                           memory_gib=memory_gib, cpus=cpus, vm_factory=vm_factory))
            for run in runs:
                checkpoint = Path(str(ROOT / run["sessionFile"]) + ".gondolin.qcow2")
                result["trials"].append(trial("smoke-test-checkpoint-{}-resume".format(run["index"]),
                                               image, ROOT / run["workspace"], checkpoint,
                                               warm_disk if run["index"] == 1 else None,
                                               vmm=vmm, memory_gib=memory_gib, cpus=cpus,
                                               vm_factory=vm_factory))
            cold = [row for row in result["trials"] if row["kind"] == "cold"]
            resumed = [row for row in result["trials"] if row["kind"].startswith("smoke-test-checkpoint-")]
            fresh_saved = next(row for row in cold if row["savedDisk"])
            smoke_saved = next(row for row in resumed if row["savedDisk"])
            result["summary"] = {
                "coldStartMedianMs": median(row["startupMs"] for row in cold),
                "coldStartTrialsMs": [row["startupMs"] for row in cold],
                "freshCheckpointResumeMs": next(row["startupMs"] for row in result["trials"]
                                                if row["kind"] == "fresh-checkpoint-resume"),
                "resumeMedianMs": median(row["startupMs"] for row in resumed),
                "smokeTestCheckpointResumeTrialsMs": [row["startupMs"] for row in resumed],
                "freshCheckpointMs": fresh_saved["checkpointMs"],
                "freshCheckpointAllocatedBytes": fresh_saved["savedDisk"]["allocatedBytes"],
                "smokeTestCheckpointMs": smoke_saved["checkpointMs"],
                "smokeTestCheckpointAllocatedBytes": smoke_saved["savedDisk"]["allocatedBytes"],
            }
            result["completed"] = True
        except (RuntimeError, OSError, ValueError, KeyError, TypeError,
                StopIteration, subprocess.SubprocessError) as exc:
            result["error"] = str(exc)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--smoke-test-result", type=Path, required=True)
    args = parser.parse_args()
    result = measure(args.smoke_test_result.resolve())
    save(result)
    raise SystemExit(0 if result["completed"] else 1)


if __name__ == "__main__":
    main()
