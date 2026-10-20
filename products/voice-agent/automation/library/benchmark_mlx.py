#!/usr/bin/python
"""Benchmark warm native MLX inference on the host."""

from ansible.module_utils.basic import AnsibleModule
from ansible.module_utils.benchmark_common import (
    common_argument_spec,
    inline_evidence,
    repository,
    run,
    stage_summary,
)

DOCUMENTATION = r"""
---
module: benchmark_mlx
short_description: Benchmark host LLM, TTS, and STT inference
description:
  - Warms the local models and measures native broker and Ollama latency, CPU, RSS, and throughput.
options:
  repo_root:
    description: Absolute repository root.
    type: path
    required: true
  iterations:
    description: Samples per inference stage.
    type: int
    default: 3
  skip_stt:
    description: Skip speech recognition.
    type: bool
    default: false
  stt_wav:
    description: Optional owner recording for speech recognition.
    type: path
  timeout_seconds:
    description: Timeout for each warm-up and benchmark command.
    type: int
    default: 7200
  report_root:
    description: Parent directory for private per-run reports.
    type: path
author:
  - agent-workload-platform contributors
"""

EXAMPLES = r"""
- name: Measure native inference
  benchmark_mlx:
    repo_root: /path/to/agent-workload-platform
    iterations: 5
"""

RETURN = r"""
summary:
  description: Per-stage median latency, throughput, CPU, and RSS.
  type: dict
  returned: when executed
report_dir:
  description: Directory containing the JSON report and runner logs.
  type: path
  returned: when executed
"""


def summarize(data):
    return {"model": data.get("model"), "iterations": data.get("iterations"),
            "stages": stage_summary(data)}


def main():
    module = AnsibleModule(argument_spec={
        **common_argument_spec(), "iterations": {"type": "int", "default": 3},
        "skip_stt": {"type": "bool", "default": False}, "stt_wav": {"type": "path"},
    }, supports_check_mode=True)
    root = repository(module)
    if module.params["iterations"] < 1:
        module.fail_json(msg="iterations must be positive")
    if module.params["skip_stt"] and module.params["stt_wav"]:
        module.fail_json(msg="skip_stt and stt_wav cannot be combined")
    voice_root = root / "products/voice-agent"
    runner = root / "platform/agent-execution/gondolin-session/benchmarks_py/host_inference.py"
    command = ["uv", "run", "--project", str(voice_root / "apps/broker"), "python", str(runner),
               "--json", "--iterations", str(module.params["iterations"])]
    if module.params["skip_stt"]:
        command.append("--skip-stt")
    if module.params["stt_wav"]:
        command.extend(("--stt-wav", module.params["stt_wav"]))
    warm_command = ["uv", "run", "--project", str(voice_root / "apps/gateway"),
                    "python", str(voice_root / "tools/ops/warm_models.py")]
    run(module, kind="mlx", command=command, warm_command=warm_command, warm_cwd=voice_root,
        evidence_reader=lambda log, _repo, report: inline_evidence(log, report),
        summarize=summarize,
        validate_result=lambda _data, summary: (
            "inference benchmark returned no stage measurements" if not summary["stages"] else None
        ))


if __name__ == "__main__":
    main()
