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
    observed = []

    class Queue:
        def __init__(self, database_url, queue_name):
            assert database_url
            assert queue_name == "agents"

        def spawn(self, task, payload, **options):
            observed.append({"task": task, "payload": payload, "options": options})
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

    assert result == {"tasks": {
        "journal": {
            "task_id": "task-1",
            "idempotency_key": "digital-twin:journal:session-7:user-3",
        },
        "classify": {
            "task_id": "task-1",
            "idempotency_key": "digital-twin:classify:session-7:user-3",
        },
    }}
    assert [call["task"] for call in observed] == [
        "digital-twin-journal",
        "digital-twin-classify",
    ]
    assert all(call["payload"]["transcript"] == "I want durable memory." for call in observed)
    assert [call["payload"]["mode"] for call in observed] == ["journal", "classify"]
    assert [call["options"] for call in observed] == [{
        "max_attempts": 3,
        "queue": "agents",
        "cancellation": {"max_duration": 180},
        "idempotency_key": f"digital-twin:{mode}:session-7:user-3",
    } for mode in ("journal", "classify")]
