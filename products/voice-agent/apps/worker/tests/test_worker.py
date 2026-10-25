import json
import io
import os
import subprocess
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

import pytest
from opentelemetry.propagate import inject
from voice_agent.tasking.infrastructure.config import Settings

from voice_worker.native_task import execute
from voice_worker.workspace_effect import prepare, finish, main as workspace_effect_main
from voice_worker.main import (
    continue_task_trace,
    prepare_repository_image,
    record_journal_decision,
    run_digital_twin,
    run_song_render,
    scratch_root_reaches_account_home,
    task_progress_publisher,
    validate_worker,
)


def test_task_progress_keeps_later_updates_after_a_fast_burst(monkeypatch) -> None:
    stored: list[str] = []

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, _query, values):
            stored.append(values[1])

    monkeypatch.setattr("voice_worker.main.psycopg.connect", lambda _url: Connection())
    publish = task_progress_publisher("postgresql://test", "task-id")
    for index in range(101):
        publish(f"Action {index}.")

    assert len(stored) == 101
    assert stored[-1] == "Action 100."
    publish("The agent is reading source files.")
    assert stored[-1] == "The agent is reading source files."


def settings(tmp_path: Path, *, sandboxed: bool) -> Settings:
    return Settings(
        database_url="postgresql://test",
        approval_secret="s" * 32,
        allowed_users=(),
        workspace_roots=(tmp_path,),
        approval_ttl_seconds=300,
        pi_model="openai-codex/gpt-5",
        pi_thinking="medium",
        pi_session_dir=tmp_path / "sessions",
        pi_execution_mode="gondolin",
        task_timeout_seconds=60,
        max_output_bytes=1024,
        skills_dir=tmp_path / "skills",
    )


def test_host_mode_skips_repository_image_preparation(tmp_path: Path, monkeypatch) -> None:
    configured = replace(settings(tmp_path, sandboxed=True), pi_execution_mode="host")
    monkeypatch.setattr(
        "voice_worker.main.ensure_execution_image",
        lambda **_kwargs: pytest.fail("host mode must not prepare a Gondolin image"),
    )
    assert prepare_repository_image(
        configured, workspace=tmp_path, workspace_reference="repository",
    ) is None


def test_worker_rejects_unknown_execution_mode(tmp_path: Path) -> None:
    configured = replace(settings(tmp_path, sandboxed=True), pi_execution_mode="unknown")
    with pytest.raises(RuntimeError, match="WORKER_PI_EXECUTION_MODE"):
        validate_worker(configured)


def test_deployment_mode_is_loaded_from_worker_environment(monkeypatch) -> None:
    monkeypatch.setenv("WORKER_PI_EXECUTION_MODE", "host")
    configured = Settings.from_env()
    assert configured.pi_execution_mode == "host"


def test_scratch_root_stays_outside_account_home(tmp_path: Path) -> None:
    home = tmp_path / "owner"
    assert scratch_root_reaches_account_home(home / "runtime" / "scratch", home)
    assert not scratch_root_reaches_account_home(tmp_path / "scratch", home)


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



def test_workspace_effect_prepares_scratch_and_projects_public_result(tmp_path: Path, monkeypatch) -> None:
    configured = replace(
        settings(tmp_path, sandboxed=True),
        worker_scratch_root=tmp_path / "scratch", pi_execution_mode="host",
    )
    monkeypatch.setattr("voice_worker.workspace_effect.validate_worker", lambda _settings: None)
    payload = {"kind": "agent-run", "params": {"workspace": "scratch", "instruction": "Create a file"},
               "requestId": "11111111-1111-4111-8111-111111111111"}
    prepared = prepare(payload, configured)
    result = finish({**payload, "workspace": prepared["workspace"], "text": "done"}, configured)
    assert result["exit_code"] == 0
    assert result["response"]["text"] == "done"
    assert prepared["instruction"].startswith("Create a file")
    assert Path(prepared["workspace"]).name == "workspace"
    assert prepare(payload, configured)["workspace"] == prepared["workspace"]


def test_workspace_progress_uses_the_bounded_owner_feed(monkeypatch, capsys) -> None:
    observed: list[str] = []
    monkeypatch.setattr("voice_worker.workspace_effect.Settings.from_env", lambda: settings(Path("/tmp"), sandboxed=False))
    monkeypatch.setattr("voice_worker.workspace_effect.task_progress_publisher",
                        lambda _url, _task_id: observed.append)
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps({
        "action": "progress", "requestId": "11111111-1111-4111-8111-111111111111",
        "spoken": "Using read." + "x" * 300,
    })))
    previous_umask = os.umask(0o077)
    try:
        workspace_effect_main()
    finally:
        os.umask(previous_umask)
    assert observed == [("Using read." + "x" * 300)[:240]]
    assert json.loads(capsys.readouterr().out) == {}


def test_native_owner_task_rejects_unknown_kind(tmp_path: Path, monkeypatch) -> None:
    configured = replace(settings(tmp_path, sandboxed=True), worker_scratch_root=tmp_path / "scratch")
    monkeypatch.setattr("voice_worker.native_task.validate_worker", lambda _settings: None)
    with pytest.raises(ValueError, match="unsupported product task"):
        execute("unknown", {"workspace": "scratch"}, "task-1", configured)
