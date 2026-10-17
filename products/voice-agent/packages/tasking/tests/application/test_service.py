from pathlib import Path

from voice_agent.tasking.application.service import TaskService
from voice_agent.tasking.infrastructure.config import Settings


def settings(tmp_path: Path) -> Settings:
    return Settings(
        database_url="postgresql://test",
        approval_secret="s" * 32,
        allowed_users=("owner@example.com",),
        workspace_roots=(tmp_path,),
        approval_ttl_seconds=300,
        queue="agents",
        pi_binary="/opt/homebrew/bin/pi",
        pi_model=None,
        pi_thinking="medium",
        pi_session_dir=tmp_path / "sessions",
        gondolin_extension=None,
        allow_unsandboxed=False,
        task_timeout_seconds=60,
        max_output_bytes=1_024,
        skills_dir=None,
    )


def test_digital_twin_turn_uses_a_retryable_idempotent_task(tmp_path: Path, monkeypatch) -> None:
    observed = {}

    class Queue:
        def __init__(self, database_url, queue_name):
            observed["database_url"] = database_url
            observed["queue_name"] = queue_name

        def spawn(self, task, payload, **options):
            observed["task"] = task
            observed["payload"] = payload
            observed["options"] = options
            return {"task_id": "task-1"}

        def close(self):
            pass

    monkeypatch.setattr("voice_agent.tasking.application.service.Absurd", Queue)
    result = TaskService(settings(tmp_path)).enqueue_digital_twin(
        identity="owner@example.com",
        session_id="session-7",
        message_id="user-3",
        transcript="  I want durable memory.  ",
        captured_at="2026-10-17T10:00:00Z",
    )

    assert result == {
        "task_id": "task-1",
        "idempotency_key": "digital-twin:session-7:user-3",
    }
    assert observed["task"] == "digital-twin-ingest"
    assert observed["payload"]["transcript"] == "I want durable memory."
    assert observed["options"] == {
        "max_attempts": 3,
        "queue": "agents",
        "cancellation": {"max_duration": 180},
        "idempotency_key": "digital-twin:session-7:user-3",
    }
