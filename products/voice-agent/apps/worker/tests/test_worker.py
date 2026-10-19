import json
import subprocess
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

import pytest
from opentelemetry.propagate import inject
from psycopg import OperationalError
from voice_agent.tasking.infrastructure.config import Settings
from voice_worker.main import (
    build_pi_command,
    build_rpc_command,
    continue_task_trace,
    create_worker,
    record_journal_decision,
    run_digital_twin,
    run_pi,
    run_song_render,
    run_worker,
)


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
        pi_rpc_host_binary=tmp_path / "pi-task-rpc",
        pi_rpc_socket_dir=tmp_path / "rpc",
        pi_rpc_idle_seconds=0,
    )


def test_command_uses_only_explicit_gondolin_tools(tmp_path: Path) -> None:
    command = build_pi_command(settings(tmp_path, sandboxed=True), task_id="abc")
    assert "--no-builtin-tools" in command
    assert command[command.index("--mode") + 1] == "rpc"
    assert command[command.index("--session-id") + 1] == "abc"
    assert command[command.index("--session-dir") + 1] == str(tmp_path / "sessions")
    assert "--extension" in command
    assert "--no-skills" in command
    assert command[command.index("--skill") + 1] == str(tmp_path / "skills")
    assert "work" not in command
    rpc = build_rpc_command(settings(tmp_path, sandboxed=True), task_id="abc")
    assert rpc[:3] == [str(tmp_path / "pi-task-rpc"), "--socket-dir", str(tmp_path / "rpc")]
    assert rpc[rpc.index("--task-id") + 1] == "abc"
    assert rpc[rpc.index("--") + 1:] == command


def test_command_refuses_unsandboxed_execution_by_default(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="PI_GONDOLIN_EXTENSION"):
        build_pi_command(settings(tmp_path, sandboxed=False), task_id="abc")


def test_run_pi_uses_rust_rpc_host_and_returns_the_initial_settled_response(
    tmp_path: Path, monkeypatch
) -> None:
    executable = tmp_path / "fake-rpc-host"
    executable.write_text(
        """#!/usr/bin/env python3
import json
import os
import sys
assert "spoken" in sys.stdin.read()
assert os.environ["TRACEPARENT"] == "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"
assert os.environ["GONDOLIN_EXECUTION_IMAGE_REF"] == "project-build:v1-v2-example"
answer = {"spoken": "Done.", "presentation": {"kind": "status", "title": "Done", "nodes": [{"id": "done", "label": "Done"}], "edges": []}}
print(json.dumps({"type": "message_end", "message": {"role": "assistant", "content": [{"type": "text", "text": json.dumps(answer)}]}}))
print(json.dumps({"type": "agent_settled"}))
""",
        encoding="utf-8",
    )
    executable.chmod(0o700)
    monkeypatch.setattr(
        "voice_worker.main.inject",
        lambda carrier: carrier.update(
            {"traceparent": "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"}
        ),
    )
    with TemporaryDirectory(prefix="awp-rpc-", dir="/tmp") as rpc_directory:
        configured = replace(
            settings(tmp_path, sandboxed=True),
            pi_rpc_host_binary=executable,
            skills_dir=None,
            pi_rpc_socket_dir=Path(rpc_directory),
        )

        result = run_pi(
            configured,
            task_id="00000000-0000-0000-0000-000000000001",
            instruction="Work",
            workspace=tmp_path,
            image_ref="project-build:v1-v2-example",
        )

    assert result["exit_code"] == 0
    assert result["response"]["spoken"] == "Done."


def test_durable_task_continues_the_queued_trace_context() -> None:
    observed: dict[str, str] = {}
    traceparent = "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01"

    with continue_task_trace({"trace_context": {"traceparent": traceparent}}):
        inject(observed)

    assert observed["traceparent"] == traceparent


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


def test_journal_decision_metrics_are_payload_free(monkeypatch) -> None:
    observed = []

    class FixedTelemetry:
        @staticmethod
        def record(operation, *, outcome="ok", count=1, duration_seconds=None):
            observed.append((operation, outcome, count, duration_seconds))

    monkeypatch.setattr("voice_worker.main.telemetry", FixedTelemetry())
    record_journal_decision({
        "mode": "journal",
        "captureId": "private-correlation-id",
        "decision": {
            "outcome": "written",
            "inputSentences": 3,
            "eligibleSentences": 2,
            "modelEntries": 2,
            "groundedEntries": 1,
            "rejectedEntries": 1,
        },
    })

    assert observed == [
        ("digital_twin.journal.decision", "written", 1, None),
        ("digital_twin.journal.sentences.input", "ok", 3, None),
        ("digital_twin.journal.sentences.eligible", "ok", 2, None),
        ("digital_twin.journal.entries.model", "ok", 2, None),
        ("digital_twin.journal.entries.written", "ok", 1, None),
        ("digital_twin.journal.entries.rejected", "ok", 1, None),
    ]
    assert "private-correlation-id" not in repr(observed)


def test_song_render_uses_injected_model_and_stores_only_the_encoded_artifact() -> None:
    manifest = {
        "title": "Signals After Midnight",
        "style": "Warm R&B",
        "lyrics": "[Verse 1]\nAcross the wire.\n[Chorus]\nShow me the trace.",
        "duration_seconds": 120,
        "bpm": 82,
        "key_scale": "D Minor",
        "time_signature": "4",
    }
    observed = {}

    def render_song(manifest):
        observed["manifest"] = manifest
        return b"encoded-m4a"

    def store_song(generation_id, audio):
        observed["generation_id"] = generation_id
        observed["audio"] = audio
        return {"audio": "s3://agent-artifacts/songs/example/song.m4a"}

    result = run_song_render(
        render_song,
        store_song,
        generation_id="00000000-0000-0000-0000-000000000001",
        manifest_payload=manifest,
    )

    assert observed["manifest"].title == "Signals After Midnight"
    assert observed["audio"] == b"encoded-m4a"
    assert result["artifacts"]["audio"].startswith("s3://")


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


def test_repository_free_task_uses_fresh_scratch_vm_and_captures_files(
    tmp_path: Path, monkeypatch
) -> None:
    registered = {}
    observed = {}

    class Queue:
        def __init__(self, *_args, **_kwargs):
            pass

        def register_task(self, name, **_kwargs):
            def keep(task):
                registered[name] = task
                return task

            return keep

    class Artifacts:
        def __init__(self, **_kwargs):
            pass

        def capture_scratch_result(self, *, workspace, **_kwargs):
            assert (workspace / "result.txt").read_text() == "done"
            return {"workspace": "s3://bucket/tasks/task-1/workspace.zip"}

    class Context:
        task_id = "task-1"

        def begin_step(self, _name):
            return SimpleNamespace(done=False)

        def complete_step(self, _handle, state):
            return state

    def fake_run_pi(_settings, *, task_id, instruction, workspace, image_ref):
        assert task_id == "task-1"
        assert instruction == "Explore the idea"
        assert image_ref == "default:image"
        assert list(workspace.iterdir()) == []
        observed["workspace"] = workspace
        (workspace / "result.txt").write_text("done")
        return {"exit_code": 0}

    monkeypatch.setattr("voice_worker.main.Absurd", Queue)
    monkeypatch.setattr("voice_worker.main.ArtifactStore", Artifacts)
    monkeypatch.setattr("voice_worker.main.validate_worker", lambda _settings: None)
    monkeypatch.setattr("voice_worker.main.run_pi", fake_run_pi)
    configured = replace(
        settings(tmp_path, sandboxed=True),
        artifact_endpoint_url="http://s3.test",
        scratch_image_ref="default:image",
        worker_scratch_root=tmp_path / "scratch",
    )
    configured.worker_scratch_root.mkdir()

    result = create_worker(configured)
    assert isinstance(result, Queue)
    completed = registered["agent-run"](
        {"workspace": "scratch", "instruction": "Explore the idea"}, Context()
    )

    assert completed["artifacts"] == {
        "workspace": "s3://bucket/tasks/task-1/workspace.zip"
    }
    assert not observed["workspace"].exists()
