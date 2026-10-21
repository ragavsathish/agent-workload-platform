"""macOS host headroom sampling for VM benchmarks."""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path


def output(*command):
    return subprocess.check_output(command, text=True).strip()


def free_memory_percent():
    match = re.search(r"System-wide memory free percentage: (\d+)%", output("memory_pressure", "-Q"))
    if not match:
        raise RuntimeError("could not read host free memory percentage")
    return int(match.group(1))


def swap_mib():
    values = {key: float(value) for key, value in re.findall(
        r"(total|used|free) = ([\d.]+)M", output("sysctl", "vm.swapusage"))}
    if "used" not in values or "free" not in values:
        raise RuntimeError("could not read host swap")
    return values


def free_disk_gib(path: Path):
    return shutil.disk_usage(path).free / (1024 ** 3)


def sample(path: Path, baseline_swap_mib: float, started: float, clock):
    swap = swap_mib()
    return {
        "elapsedMs": round((clock() - started) * 1000),
        "freeMemoryPercent": free_memory_percent(),
        "swapUsedMiB": swap["used"],
        "swapFreeMiB": swap["free"],
        "swapGrowthMiB": round(swap["used"] - baseline_swap_mib, 2),
        "freeDiskGiB": round(free_disk_gib(path), 2),
    }
