import json
import subprocess
from dataclasses import replace
from pathlib import Path

import pytest
from psycopg import OperationalError
from voice_agent.tasking.infrastructure.config import Settings
from voice_worker.main import build_pi_command, run_digital_twin, run_worker


def settings(tmp_path: Path, *, sandboxed: bool) -> Settings:
    return Settings(
        database_url="postgresql://test",
        approval_secret="s" * 32,
        allowed_users=(),
        workspace_roots=(tmp_path,),
        approval_ttl_seconds=300,
        queue="agents",
        pi_binary="/opt/homebrew/bin/pi",
        pi_model="openai-codex/gpt-5",
        pi_thinking="medium",
        pi_session_dir=tmp_path / "sessions",
        gondolin_extension=(tmp_path / "gondolin.ts") if sandboxed else None,
        allow_unsandboxed=False,
        task_timeout_seconds=60,
        max_output_bytes=1024,
        skills_dir=tmp_path / "skills",
    )


def test_command_uses_only_explicit_gondolin_tools(tmp_path: Path) -> None:
    command = build_pi_command(
        settings(tmp_path, sandboxed=True), task_id="abc", instruction="work"
    )
    assert "--no-builtin-tools" in command
    assert "--no-session" in command
    assert "--session-id" not in command
    assert "--session-dir" not in command
    assert "--extension" in command
    assert "--no-skills" in command
    assert command[command.index("--skill") + 1] == str(tmp_path / "skills")
    assert command[-2] == "--"
    assert command[-1].startswith("work\n\n")
    assert '"spoken" and "presentation"' in command[-1]


def test_command_refuses_unsandboxed_execution_by_default(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="PI_GONDOLIN_EXTENSION"):
        build_pi_command(settings(tmp_path, sandboxed=False), task_id="abc", instruction="work")


def test_digital_twin_task_invokes_the_dedicated_vm_runner(tmp_path: Path, monkeypatch) -> None:
    runner = tmp_path / "task-runner.js"
    runner.write_text("", encoding="utf-8")
    configured = replace(settings(tmp_path, sandboxed=True), digital_twin_runner=runner)
    observed = {}

    def completed(command, **kwargs):
        observed["command"] = command
        observed.update(kwargs)
        return subprocess.CompletedProcess(command, 0, stdout='{"entries": 1}\n', stderr="")

    monkeypatch.setattr("voice_worker.main.subprocess.run", completed)
    result = run_digital_twin(configured, {"sessionId": "session-7"})

    assert observed["command"] == [configured.node_binary, str(runner)]
    assert json.loads(observed["input"])["sessionId"] == "session-7"
    assert result == {"entries": 1}


def test_worker_reconnects_after_a_temporary_database_outage(
    tmp_path: Path, monkeypatch
) -> None:
    events: list[str] = []

    class FakeWorker:
        def __init__(self, *, fails: bool) -> None:
            self.fails = fails

        def start_worker(self, *, concurrency: int) -> None:
            assert concurrency == 1
            events.append("start")
            if self.fails:
                raise OperationalError("database unavailable")

        def close(self) -> None:
            events.append("close")

    workers = iter((FakeWorker(fails=True), FakeWorker(fails=False)))
    monkeypatch.setattr("voice_worker.main.create_worker", lambda _settings: next(workers))
    monkeypatch.setattr(
        "voice_worker.main.time.sleep", lambda delay: events.append(f"sleep:{delay}")
    )

    run_worker(settings(tmp_path, sandboxed=True))

    assert events == ["start", "sleep:2.0", "close", "start", "close"]
