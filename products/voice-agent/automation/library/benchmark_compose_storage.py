#!/usr/bin/python
"""Benchmark one project Compose VM storage driver."""

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
module: benchmark_compose_storage
short_description: Benchmark one Gondolin Docker storage driver
description:
  - Measures project Compose startup and guest disk use for VFS or Overlay2.
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
    description: Host project directory mounted at /workspace in the VM.
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
  vm_memory_gib:
    description: Guest memory in GiB.
    type: int
    default: 8
  vm_cpus:
    description: Guest vCPUs.
    type: int
    default: 4
  vmm:
    description: VM monitor backend.
    type: str
    choices: [qemu, krun]
    default: qemu
  storage_driver:
    description: Expected Docker storage driver.
    type: str
    choices: [vfs, overlay2]
    required: true
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
- name: Measure Overlay2 startup
  benchmark_compose_storage:
    repo_root: /path/to/agent-workload-platform
    image: voice-agent-gondolin:dev-overlay2
    workspace: /path/to/project
    compose_file: compose.yml
    storage_driver: overlay2
"""

RETURN = r"""
summary:
  description: Startup time and guest disk metrics.
  type: dict
  returned: when executed
report_dir:
  description: Directory containing the JSON report and runner log.
  type: path
  returned: when executed
"""


def summarize(data):
    guest = {}
    guest.update(data.get("metrics", {}))
    return {
        "storage_driver": data.get("driver"),
        "startup_ms": data.get("startupMs"),
        "probe_exit_code": data.get("probeExitCode"),
        "guest_metrics": guest,
        "error": data.get("error"),
    }


def main():
    module = AnsibleModule(argument_spec={
        **common_argument_spec(), **compose_argument_spec(),
        "image": {"type": "str", "required": True},
        "storage_driver": {"type": "str", "required": True, "choices": ["vfs", "overlay2"]},
        "vm_memory_gib": {"type": "int", "default": 8},
        "vm_cpus": {"type": "int", "default": 4},
        "vmm": {"type": "str", "choices": ["qemu", "krun"], "default": "qemu"},
    }, required_one_of=[["compose_file", "workload_command"]],
        mutually_exclusive=[["compose_file", "workload_command"]], supports_check_mode=True)
    root = repository(module)
    require_range(module, "vm_memory_gib", 1, 64)
    require_range(module, "vm_cpus", 1, 14)
    command = python_runner(root, "compose_storage.py") + ["--image", module.params["image"]]
    command += compose_cli_arguments(module)
    command += ["--storage-driver", module.params["storage_driver"],
                "--vm-memory-gib", str(module.params["vm_memory_gib"]),
                "--vm-cpus", str(module.params["vm_cpus"]), "--vmm", module.params["vmm"]]
    run(module, kind="compose_storage", command=command,
        environment={"GONDOLIN_BENCHMARK_GUEST_ENV_JSON": json.dumps(module.params["guest_environment"])},
        evidence_reader=saved_result_evidence,
        summarize=summarize,
        validate_result=lambda _data, summary: (
            "Compose storage probe failed" if summary["probe_exit_code"] != 0 else None
        ))


if __name__ == "__main__":
    main()
