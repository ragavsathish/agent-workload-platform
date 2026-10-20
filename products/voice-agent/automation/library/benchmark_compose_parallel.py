#!/usr/bin/python
"""Benchmark readiness of parallel project Compose VMs."""

import json

from ansible.module_utils.basic import AnsibleModule
from ansible.module_utils.benchmark_common import (
    common_argument_spec,
    compose_argument_spec,
    compose_cli_arguments,
    python_runner,
    repository,
    require_range,
    run,
    saved_result_evidence,
)

DOCUMENTATION = r"""
---
module: benchmark_compose_parallel
short_description: Benchmark parallel project Compose VM startup
description:
  - Starts a project workload in independent Gondolin VMs and measures readiness and host headroom.
options:
  repo_root:
    description: Absolute repository root.
    type: path
    required: true
  image:
    description: Gondolin image path or reference.
    type: str
    required: true
  workspace:
    description: Host project directory mounted at /workspace in each VM.
    type: path
    required: true
  compose_file:
    description: Compose file relative to workspace. Required unless workload_command is set.
    type: str
  workload_command:
    description: Guest argument vector for a custom project startup. Required unless compose_file is set.
    type: list
    elements: str
  bootstrap_command:
    description: Guest argument vector that starts Docker before the project workload. Empty disables it.
    type: list
    elements: str
    default: [/usr/local/bin/start-dev-docker]
  compose_wait:
    description: Wait for Compose services to become running or healthy.
    type: bool
    default: true
  image_cache:
    description: Optional host directory mounted read-only at /image-cache.
    type: path
  guest_environment:
    description: Guest environment variables for project startup. Values are omitted from reports.
    type: dict
  expected_driver:
    description: Expected guest Docker storage driver.
    type: str
    choices: [vfs, overlay2]
    default: overlay2
  parallelism:
    description: Number of concurrent VMs.
    type: int
    default: 2
  vm_memory_gib:
    description: Guest memory per VM in GiB.
    type: int
    default: 6
  vm_cpus:
    description: Guest vCPUs per VM.
    type: int
    default: 2
  guest_swap_gib:
    description: Guest swapfile size in GiB.
    type: int
    default: 0
  vmm:
    description: VM monitor backend.
    type: str
    choices: [qemu, krun]
    default: qemu
  min_free_memory_percent:
    description: Host memory floor.
    type: int
    default: 25
  max_swap_growth_mib:
    description: Host swap growth ceiling.
    type: int
    default: 256
  min_free_disk_gib:
    description: Host free disk floor.
    type: int
    default: 30
  timeout_seconds:
    description: Runner timeout.
    type: int
    default: 7200
  report_root:
    description: Parent directory for private per-run reports.
    type: path
author:
  - agent-workload-platform contributors
"""

EXAMPLES = r"""
- name: Measure four Compose VMs
  benchmark_compose_parallel:
    repo_root: /path/to/agent-workload-platform
    image: /path/to/guest-image/aarch64
    workspace: /path/to/project
    compose_file: compose.yml
    parallelism: 4
"""

RETURN = r"""
summary:
  description: Readiness and host resource metrics.
  type: dict
  returned: when executed
report_dir:
  description: Directory containing the JSON report and runner log.
  type: path
  returned: when executed
"""


def summarize(data):
    ready = data.get("readinessMs", [])
    return {
        "ready_vms": sum(isinstance(value, (int, float)) for value in ready),
        "total_vms": data.get("parallelism"),
        "readiness_ms": ready,
        "wall_clock_ms": data.get("wallClockMs"),
        "minimum_host_free_memory_percent": data.get("minFreeMemoryPercent"),
        "maximum_host_swap_growth_mib": data.get("maxSwapGrowthMiB"),
        "minimum_host_free_disk_gib": data.get("minFreeDiskGiB"),
        "error": data.get("error"),
    }


def main():
    module = AnsibleModule(argument_spec={
        **common_argument_spec(), **compose_argument_spec(),
        "image": {"type": "str", "required": True},
        "expected_driver": {"type": "str", "choices": ["vfs", "overlay2"], "default": "overlay2"},
        "parallelism": {"type": "int", "default": 2}, "vm_memory_gib": {"type": "int", "default": 6},
        "vm_cpus": {"type": "int", "default": 2}, "guest_swap_gib": {"type": "int", "default": 0},
        "vmm": {"type": "str", "choices": ["qemu", "krun"], "default": "qemu"},
        "min_free_memory_percent": {"type": "int", "default": 25},
        "max_swap_growth_mib": {"type": "int", "default": 256},
        "min_free_disk_gib": {"type": "int", "default": 30},
    }, required_one_of=[["compose_file", "workload_command"]],
        mutually_exclusive=[["compose_file", "workload_command"]], supports_check_mode=True)
    root = repository(module)
    for name, lower, upper in (("parallelism", 1, 8), ("vm_memory_gib", 1, 64),
                               ("vm_cpus", 1, 14), ("guest_swap_gib", 0, 16),
                               ("min_free_memory_percent", 0, 100)):
        require_range(module, name, lower, upper)
    for name in ("max_swap_growth_mib", "min_free_disk_gib"):
        if module.params[name] < 0:
            module.fail_json(msg=f"{name} must be nonnegative")
    command = python_runner(root, "compose_parallel.py") + ["--image", module.params["image"]]
    command += compose_cli_arguments(module)
    command += ["--expected-driver", module.params["expected_driver"],
               "--parallelism", str(module.params["parallelism"]),
               "--vm-memory-gib", str(module.params["vm_memory_gib"]),
               "--vm-cpus", str(module.params["vm_cpus"]),
               "--guest-swap-gib", str(module.params["guest_swap_gib"]),
               "--vmm", module.params["vmm"],
               "--min-free-memory-percent", str(module.params["min_free_memory_percent"]),
               "--max-swap-growth-mib", str(module.params["max_swap_growth_mib"]),
               "--min-free-disk-gib", str(module.params["min_free_disk_gib"])]
    run(module, kind="compose_parallel", command=command,
        environment={"GONDOLIN_BENCHMARK_GUEST_ENV_JSON": json.dumps(module.params["guest_environment"])},
        evidence_reader=saved_result_evidence,
        summarize=summarize,
        validate_result=lambda data, summary: (
            "not all Compose VMs became ready"
            if not data.get("allReady") or summary["ready_vms"] != module.params["parallelism"] else None
        ))


if __name__ == "__main__":
    main()
