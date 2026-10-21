#!/usr/bin/python
"""Measure Gondolin cold start, resume, and checkpoint operations."""

from ansible.module_utils.basic import AnsibleModule
from ansible.module_utils.benchmark_common import (
    common_argument_spec,
    python_runner,
    repository,
    run,
    saved_result_evidence,
)

DOCUMENTATION = r"""
---
module: benchmark_lifecycle
short_description: Benchmark Gondolin VM lifecycle operations
description:
  - Measures cold boot, checkpoint resume, and checkpoint storage from a VM smoke test result.
options:
  repo_root:
    description: Absolute repository root.
    type: path
    required: true
  smoke_test_result:
    description: Path to a VM smoke test result with retained checkpoints.
    type: path
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
- name: Measure VM lifecycle
  benchmark_lifecycle:
    repo_root: /path/to/agent-workload-platform
    smoke_test_result: /path/to/artifacts/benchmarks/smoke-test-run/result.json
"""

RETURN = r"""
summary:
  description: Cold start, resume, and checkpoint metrics.
  type: dict
  returned: when executed
report_dir:
  description: Directory containing the JSON report and runner log.
  type: path
  returned: when executed
"""


def main():
    module = AnsibleModule(argument_spec={
        **common_argument_spec(), "smoke_test_result": {"type": "path", "required": True},
    }, supports_check_mode=True)
    root = repository(module)
    command = python_runner(root, "lifecycle.py") + ["--smoke-test-result", module.params["smoke_test_result"]]
    run(module, kind="lifecycle", command=command,
        evidence_reader=saved_result_evidence,
        summarize=lambda data: data.get("summary", {}),
        validate_result=lambda data, _summary: (
            "VM lifecycle benchmark did not complete" if not data.get("completed") else None
        ))


if __name__ == "__main__":
    main()
