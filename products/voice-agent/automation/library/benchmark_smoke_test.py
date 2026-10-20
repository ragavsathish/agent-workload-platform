#!/usr/bin/python
"""Benchmark project-defined Pi and Gondolin VM smoke tests."""

import json
from pathlib import Path

from ansible.module_utils.basic import AnsibleModule
from ansible.module_utils.benchmark_common import (
    common_argument_spec,
    python_runner,
    repository,
    require_range,
    run,
    saved_result_evidence,
)

DOCUMENTATION = r"""
---
module: benchmark_smoke_test
short_description: Benchmark concurrent Gondolin VM smoke tests through Pi
description:
  - Starts independent Pi sessions in project checkouts with a prompt supplied as a file.
  - Reports per-VM success, duration, host memory, swap, disk, and runner evidence.
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
    description: Git project checkout to clone for each VM.
    type: path
    required: true
  prompt_file:
    description: Pi smoke test prompt file. Defaults to a generic VM command probe.
    type: path
  config_path:
    description: Project-relative Gondolin configuration file.
    type: str
    default: .pi/gondolin.json
  extension:
    description: Pi Gondolin extension file. Defaults to this repository's built extension.
    type: path
  assets:
    description: Optional Gondolin browser assets directory.
    type: path
  image_cache:
    description: Optional host image cache directory.
    type: path
  metrics_dir:
    description: Optional Gondolin metrics directory.
    type: path
  session_label:
    description: Metrics label used by the Pi extension.
    type: str
    default: pi-dev-worktree
  capture_path:
    description: Optional project-relative test artifact directory or symlink to copy after the run.
    type: str
  guest_environment:
    description: Guest environment overrides. Values are omitted from reports.
    type: dict
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
  vmm:
    description: VM monitor backend.
    type: str
    choices: [qemu, krun]
    default: qemu
  retain_checkpoints:
    description: Keep task VM disks for a later lifecycle benchmark.
    type: bool
    default: false
  overlays:
    description: Project-relative files copied into each checkout.
    type: list
    elements: str
    default: []
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
  min_free_swap_mib:
    description: Host free swap floor.
    type: int
    default: 256
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
- name: Measure three project VM smoke tests
  benchmark_smoke_test:
    repo_root: /path/to/agent-workload-platform
    workspace: /path/to/project
    image: /path/to/gondolin-image
    prompt_file: /path/to/project/smoke-test.md
    parallelism: 3
"""

RETURN = r"""
summary:
  description: Bounded success and host resource metrics.
  type: dict
  returned: when executed
report_dir:
  description: Directory containing the JSON report and runner log.
  type: path
  returned: when executed
"""


def summarize(data):
    rows = data.get("runs", [])
    return {
        "passed_vms": sum(row.get("piExitCode") == 0 and row.get("commandExitCode") == 0 for row in rows),
        "total_vms": len(rows),
        "durations_seconds": [row.get("durationSeconds") for row in rows],
        "peak_registered_vm_rss_bytes": data.get("peakCombinedVmRssBytes"),
        "minimum_host_free_memory_percent": data.get("minHostFreeMemoryPercent"),
        "host_swap_growth_mib": data.get("swapGrowthMiB"),
        "minimum_host_free_disk_gib": data.get("minFreeDiskGiB"),
        "stop_reason": data.get("stopReason"),
    }


def main():
    module = AnsibleModule(argument_spec={
        **common_argument_spec(),
        "image": {"type": "str", "required": True},
        "workspace": {"type": "path", "required": True},
        "prompt_file": {"type": "path"},
        "config_path": {"type": "str", "default": ".pi/gondolin.json"},
        "extension": {"type": "path"},
        "assets": {"type": "path"},
        "image_cache": {"type": "path"},
        "metrics_dir": {"type": "path"},
        "session_label": {"type": "str", "default": "pi-dev-worktree"},
        "capture_path": {"type": "str"},
        "guest_environment": {"type": "dict", "default": {}, "no_log": True},
        "parallelism": {"type": "int", "default": 2}, "vm_memory_gib": {"type": "int", "default": 6},
        "vm_cpus": {"type": "int", "default": 2}, "vmm": {"type": "str", "choices": ["qemu", "krun"], "default": "qemu"},
        "retain_checkpoints": {"type": "bool", "default": False},
        "overlays": {"type": "list", "elements": "str", "default": []},
        "min_free_memory_percent": {"type": "int", "default": 25},
        "max_swap_growth_mib": {"type": "int", "default": 256},
        "min_free_disk_gib": {"type": "int", "default": 30},
        "min_free_swap_mib": {"type": "int", "default": 256},
    }, supports_check_mode=True)
    root = repository(module)
    workspace = Path(module.params["workspace"]).resolve()
    if not workspace.is_dir() or not (workspace / ".git").exists():
        module.fail_json(msg="workspace must be a Git checkout")
    prompt_file = Path(module.params["prompt_file"] or root /
                       "platform/agent-execution/gondolin-session/benchmarks_py/prompts/vm_smoke_test.md").resolve()
    if not prompt_file.is_file():
        module.fail_json(msg=f"prompt_file is not a file: {prompt_file}")
    config_path = (workspace / module.params["config_path"]).resolve()
    if not config_path.is_relative_to(workspace) or not config_path.is_file():
        module.fail_json(msg="config_path must be a file inside workspace")
    for name in ("extension", "assets", "image_cache"):
        if module.params[name] and not Path(module.params[name]).exists():
            module.fail_json(msg=f"{name} does not exist")
    for name, lower, upper in (("parallelism", 1, 8), ("vm_memory_gib", 1, 64),
                               ("vm_cpus", 1, 14), ("min_free_memory_percent", 0, 100)):
        require_range(module, name, lower, upper)
    for name in ("max_swap_growth_mib", "min_free_disk_gib", "min_free_swap_mib"):
        if module.params[name] < 0:
            module.fail_json(msg=f"{name} must be nonnegative")
    for overlay in module.params["overlays"]:
        path = (workspace / overlay).resolve()
        if not path.is_relative_to(workspace) or not path.is_file():
            module.fail_json(msg=f"overlay is not a project file: {overlay}")

    command = python_runner(root, "smoke_test.py") + [
               "--workspace", str(workspace), "--image", module.params["image"],
               "--prompt-file", str(prompt_file), "--config-path", module.params["config_path"],
               "--parallelism", str(module.params["parallelism"]),
               "--vm-memory", "{}G".format(module.params["vm_memory_gib"]),
               "--vm-cpus", str(module.params["vm_cpus"]), "--vmm", module.params["vmm"],
               "--min-free-memory-percent", str(module.params["min_free_memory_percent"]),
               "--max-swap-growth-mib", str(module.params["max_swap_growth_mib"]),
               "--min-free-disk-gib", str(module.params["min_free_disk_gib"]),
               "--min-free-swap-mib", str(module.params["min_free_swap_mib"])]
    if module.params["retain_checkpoints"]:
        command.append("--retain-checkpoints")
    for name, option in (("extension", "--extension"), ("assets", "--assets"),
                         ("image_cache", "--image-cache"), ("metrics_dir", "--metrics-dir"),
                         ("capture_path", "--capture-path")):
        if module.params[name]:
            command.extend((option, module.params[name]))
    command.extend(("--session-label", module.params["session_label"]))
    for overlay in module.params["overlays"]:
        command.extend(("--overlay", overlay))
    environment = {"GONDOLIN_BENCHMARK_GUEST_ENV_JSON": json.dumps(module.params["guest_environment"])}

    run(module, kind="smoke_test", command=command, environment=environment,
        evidence_reader=saved_result_evidence,
        summarize=summarize,
        validate_result=lambda _data, summary: (
            "not all VM smoke tests passed" if summary["passed_vms"] != module.params["parallelism"] else None
        ))


if __name__ == "__main__":
    main()
