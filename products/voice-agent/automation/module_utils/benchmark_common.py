"""Shared local execution and report handling for benchmark modules."""

from __future__ import annotations

import json
import os
import platform
import re
import statistics
import subprocess
import sys
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path


def common_argument_spec():
    return {
        "repo_root": {"type": "path", "required": True},
        "timeout_seconds": {"type": "int", "default": 7200},
        "report_root": {"type": "path"},
    }


def compose_argument_spec():
    return {
        "workspace": {"type": "path", "required": True},
        "compose_file": {"type": "str"},
        "workload_command": {"type": "list", "elements": "str"},
        "bootstrap_command": {"type": "list", "elements": "str",
                              "default": ["/usr/local/bin/start-dev-docker"]},
        "compose_wait": {"type": "bool", "default": True},
        "image_cache": {"type": "path"},
        "guest_environment": {"type": "dict", "default": {}, "no_log": True},
    }


def python_runner(root, filename):
    return [sys.executable, str(root / "platform/agent-execution/gondolin-session/benchmarks_py" / filename)]


def compose_cli_arguments(module):
    params = module.params
    workspace = Path(params["workspace"]).resolve()
    if not workspace.is_dir():
        module.fail_json(msg=f"workspace is not a directory: {workspace}")
    args = ["--workspace", str(workspace)]
    if params["compose_file"]:
        compose = (workspace / params["compose_file"]).resolve()
        if not compose.is_relative_to(workspace) or not compose.is_file():
            module.fail_json(msg="compose_file must be a file inside workspace")
        args.extend(("--compose-file", str(compose.relative_to(workspace))))
    elif params["workload_command"]:
        args.extend(("--workload-command-json", json.dumps(params["workload_command"])))
    else:
        module.fail_json(msg="workload_command must contain at least one argument")
    args.extend(("--bootstrap-command-json", json.dumps(params["bootstrap_command"])))
    if params["image_cache"]:
        cache = Path(params["image_cache"]).resolve()
        if not cache.is_dir():
            module.fail_json(msg=f"image_cache is not a directory: {cache}")
        args.extend(("--image-cache", str(cache)))
    if not params["compose_wait"]:
        args.append("--no-compose-wait")
    return args


def timestamp():
    return datetime.now(UTC).isoformat(timespec="seconds")


def repository(module):
    root = Path(module.params["repo_root"]).resolve()
    runners = root / "platform/agent-execution/gondolin-session/benchmarks_py"
    if not root.is_dir() or not (runners / "smoke_test.py").is_file():
        module.fail_json(msg="repo_root does not contain the benchmark runners")
    if module.params["timeout_seconds"] < 1:
        module.fail_json(msg="timeout_seconds must be positive")
    return root


def require_range(module, name, minimum, maximum):
    value = module.params[name]
    if not minimum <= value <= maximum:
        module.fail_json(msg=f"{name} must be between {minimum} and {maximum}")


def private_json(path, value):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent,
                                         prefix=".report-", delete=False) as output:
            temporary = Path(output.name)
            os.chmod(temporary, 0o600)
            json.dump(value, output, indent=2, allow_nan=False)
            output.write("\n")
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def log_tail(path, size=2_000_000):
    with open(path, "rb") as source:
        source.seek(0, os.SEEK_END)
        source.seek(max(0, source.tell() - size))
        return source.read().decode("utf-8", errors="replace")


def path_evidence(log_path, root, pattern):
    matches = re.findall(pattern, log_tail(log_path), flags=re.MULTILINE)
    if not matches:
        raise ValueError("runner did not print a result path; inspect runner.log")
    path = Path(matches[-1]).resolve()
    if not path.is_relative_to(root / "artifacts/benchmarks"):
        raise ValueError("runner result path is outside the benchmark artifacts directory")
    return path, json.loads(path.read_text(encoding="utf-8"))


def saved_result_evidence(log_path, root, _report_dir):
    return path_evidence(log_path, root, r"^RESULT (.+)$")


def inline_evidence(log_path, report_dir, last_line=False):
    content = log_tail(log_path)
    if last_line:
        rows = [line for line in content.splitlines() if line.startswith("{")]
        if not rows:
            raise ValueError("runner did not print JSON evidence")
        data = json.loads(rows[-1])
    else:
        data = json.loads(content)
    path = report_dir / "evidence.json"
    private_json(path, data)
    return path, data


def stage_summary(data):
    stages = {}
    for stage in ("llm", "tts", "stt"):
        rows = [row for row in data.get("results", []) if row.get("stage") == stage]
        if rows:
            stages[stage] = {
                "median_wall_seconds": statistics.median(row["wall_seconds"] for row in rows),
                "mean_units_per_second": statistics.mean(row["units_per_second"] for row in rows),
                "unit": rows[0]["unit"],
                "peak_rss_mib": max(row["peak_rss_mib"] for row in rows),
                "peak_cpu_percent": max(row["peak_cpu_percent"] for row in rows),
            }
    return stages


def run(module, *, kind, command, evidence_reader, summarize, validate_result=None,
        environment=None, cwd=None, warm_command=None, warm_cwd=None):
    root = repository(module)
    if module.check_mode:
        module.exit_json(changed=True, success=True, planned_command=command,
                         msg="benchmark would run and create a new report")

    parent = Path(module.params.get("report_root") or root / "artifacts/benchmarks/ansible").resolve()
    directory = parent / (datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ") +
                          "-" + kind + "-" + uuid.uuid4().hex[:8])
    directory.mkdir(parents=True, mode=0o700)
    os.chmod(directory, 0o700)
    log_path = directory / "runner.log"
    warm_log_path = directory / "warm-models.log" if warm_command else None
    env = os.environ.copy()
    env.update(environment or {})
    started = timestamp()
    error = None
    return_code = None

    if warm_command:
        try:
            with open(warm_log_path, "wb") as output:
                os.chmod(warm_log_path, 0o600)
                result = subprocess.run(warm_command, cwd=warm_cwd or root, env=env, stdout=output,
                                        stderr=subprocess.STDOUT,
                                        timeout=module.params["timeout_seconds"], check=False)
            if result.returncode:
                error = f"model warm-up exited with status {result.returncode}"
        except subprocess.TimeoutExpired:
            error = "model warm-up exceeded timeout_seconds={}".format(module.params["timeout_seconds"])
        except OSError as exc:
            error = f"could not launch model warm-up: {exc}"

    try:
        with open(log_path, "wb") as output:
            os.chmod(log_path, 0o600)
            if error is None:
                result = subprocess.run(command, cwd=cwd or root, env=env, stdout=output,
                                        stderr=subprocess.STDOUT,
                                        timeout=module.params["timeout_seconds"], check=False)
                return_code = result.returncode
    except subprocess.TimeoutExpired:
        error = "runner exceeded timeout_seconds={}".format(module.params["timeout_seconds"])
    except OSError as exc:
        error = f"could not launch runner: {exc}"

    evidence_path = None
    summary = {}
    if return_code is not None:
        try:
            evidence_path, evidence = evidence_reader(log_path, root, directory)
            summary = summarize(evidence)
            if validate_result:
                error = error or validate_result(evidence, summary)
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
            error = error or f"could not read runner evidence: {exc}"
    if return_code not in (None, 0):
        error = "runner exited with status {}{}".format(
            return_code, "; " + error if error else ""
        )

    finished = timestamp()
    parameters = {key: (sorted(value.keys()) if key == "guest_environment" else value)
                  for key, value in module.params.items()
                  if key not in ("repo_root", "report_root")}
    report = {
        "schema_version": 1, "benchmark": kind, "started_at_utc": started,
        "finished_at_utc": finished, "host": platform.node(), "success": error is None,
        "return_code": return_code, "error": error, "command": command,
        "parameters": parameters, "summary": summary,
        "evidence_path": str(evidence_path) if evidence_path else None,
        "runner_log": str(log_path),
        "warm_log": str(warm_log_path) if warm_log_path else None,
    }
    report_path = directory / "report.json"
    private_json(report_path, report)
    answer = {"changed": True, "success": report["success"], "benchmark": kind,
                  "started_at_utc": started, "finished_at_utc": finished,
                  "host": report["host"], "return_code": return_code, "error": error,
                  "report_dir": str(directory), "json_report": str(report_path),
                  "runner_log": str(log_path), "warm_log": report["warm_log"],
                  "evidence_path": report["evidence_path"],
                  "summary": summary, "parameters": parameters}
    if error:
        module.fail_json(msg=error, **answer)
    module.exit_json(**answer)
