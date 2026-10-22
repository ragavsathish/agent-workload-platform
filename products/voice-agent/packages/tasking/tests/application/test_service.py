from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from voice_agent.tasking.application.service import (
    ProposalError,
    TaskService,
    bounded_trace_context,
    persisted_plan_hash_is_valid,
)
from voice_agent.tasking.domain.approval import plan_hash
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


@pytest.mark.parametrize(
    ("workspace", "name", "filename"),
    [("scratch", "workspace", "workspace.zip"), ("repository", "patch", "changes.patch")],
)
def test_artifact_requires_owned_task_and_declared_kind(
    tmp_path: Path, monkeypatch, workspace: str, name: str, filename: str
) -> None:
    service = TaskService(settings(tmp_path))
    task_id = "11111111-1111-4111-8111-111111111111"

    class Store:
        bucket = "agent-artifacts"

        def get_task_artifact(self, **kwargs):
            assert kwargs == {"task_id": task_id, "name": name, "max_bytes": 16_777_216}
            return b"artifact", filename, "application/octet-stream"

    service.artifacts = Store()

    def get_owned(identity, proposal_id):
        if identity != "owner@example.com":
            raise ProposalError("proposal not found")
        assert proposal_id == "proposal-1"
        return {"workspace": workspace, "task_id": task_id}

    monkeypatch.setattr(service, "_get_owned", get_owned)
    artifact_uri = f"s3://agent-artifacts/tasks/{task_id}/{filename}"
    monkeypatch.setattr(
        service, "_task_result", lambda _: {"result": {"artifacts": {name: artifact_uri}}}
    )

    assert service.artifact(
        identity="owner@example.com", proposal_id="proposal-1", name=name
    )[0] == b"artifact"
    with pytest.raises(ProposalError, match="proposal not found"):
        service.artifact(identity="stranger@example.com", proposal_id="proposal-1", name=name)
    other_name = "patch" if name == "workspace" else "workspace"
    with pytest.raises(ProposalError, match="unavailable"):
        service.artifact(
            identity="owner@example.com", proposal_id="proposal-1", name=other_name
        )
    monkeypatch.setattr(
        service, "_task_result", lambda _: {"result": {"artifacts": {name: "s3://wrong"}}}
    )
    with pytest.raises(ProposalError, match="unavailable"):
        service.artifact(identity="owner@example.com", proposal_id="proposal-1", name=name)


def test_digital_twin_turn_uses_a_retryable_idempotent_task(
    tmp_path: Path, monkeypatch
) -> None:
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

    assert result == {
        "tasks": {
            "journal": {
                "task_id": "task-1",
                "idempotency_key": "digital-twin:journal:session-7:user-3",
            },
            "classify": {
                "task_id": "task-1",
                "idempotency_key": "digital-twin:classify:session-7:user-3",
            },
        }
    }
    assert [call["task"] for call in observed] == [
        "digital-twin-journal",
        "digital-twin-classify",
    ]
    assert all(
        call["payload"]["transcript"] == "I want durable memory." for call in observed
    )
    assert [call["payload"]["mode"] for call in observed] == ["journal", "classify"]
    assert [call["options"] for call in observed] == [
        {
            "max_attempts": 3,
            "queue": "agents",
            "cancellation": {"max_duration": 180},
            "idempotency_key": f"digital-twin:{mode}:session-7:user-3",
        }
        for mode in ("journal", "classify")
    ]


def test_task_view_exposes_the_persisted_session_album(
    tmp_path: Path, monkeypatch
) -> None:
    service = TaskService(settings(tmp_path))
    monkeypatch.setattr(service, "_task_result", lambda _task_id: None)
    now = datetime.now(UTC)

    view = service._view(
        {
            "id": "7e635c29-8840-4aad-b840-f6d5a344ef68",
            "identity": "owner@example.com",
            "instruction": "Inspect the repository",
            "workspace": str(tmp_path),
            "session_album_key": "kind-of-blue",
            "session_name": "Kind of Blue",
            "plan_hash": "a" * 64,
            "status": "pending",
            "task_id": None,
            "created_at": now,
            "expires_at": now + timedelta(minutes=5),
        },
        include_token=False,
    )

    assert view["session_name"] == "Kind of Blue"
    assert view["session_reference"] == {
        "artist": "Miles Davis",
        "spotify_url": "https://open.spotify.com/album/1weenld61qoidwYuZ1GESA",
    }


def test_plan_hash_accepts_legacy_rows_but_new_rows_bind_the_album() -> None:
    row = {
        "instruction": "Inspect the repository",
        "workspace": "/workspace",
        "session_album_key": "kind-of-blue",
        "session_name": "Kind of Blue · Take 2",
    }
    legacy = plan_hash(
        {"instruction": row["instruction"], "workspace": row["workspace"]}
    )
    album_only = plan_hash(
        {
            "instruction": row["instruction"],
            "workspace": row["workspace"],
            "session_album_key": row["session_album_key"],
        }
    )
    current = plan_hash(row)

    assert persisted_plan_hash_is_valid({**row, "plan_hash": legacy})
    assert persisted_plan_hash_is_valid({**row, "plan_hash": album_only})
    assert persisted_plan_hash_is_valid({**row, "plan_hash": current})
    assert not persisted_plan_hash_is_valid(
        {**row, "session_album_key": "blue-train", "plan_hash": current}
    )
    assert not persisted_plan_hash_is_valid(
        {**row, "session_name": "Kind of Blue · Take 3", "plan_hash": current}
    )


def test_scratch_plan_does_not_resolve_a_repository(tmp_path: Path) -> None:
    service = TaskService(settings(tmp_path))
    assert service._plan("  Explore an idea  ", "scratch") == {
        "instruction": "Explore an idea",
        "workspace": "scratch",
    }


def test_scratch_only_configuration_needs_no_repository_allowlist(tmp_path: Path) -> None:
    configured = replace(settings(tmp_path), workspace_roots=())
    service = TaskService(configured)
    assert service._plan("Explore an idea", "scratch")["workspace"] == "scratch"
    with pytest.raises(ValueError, match="outside"):
        service._plan("Explore an idea", str(tmp_path / "missing"))


def test_scratch_plan_does_not_query_the_artifact_store(tmp_path: Path, monkeypatch) -> None:
    configured = replace(
        settings(tmp_path),
        artifact_endpoint_url="http://s3.test",
        artifact_bucket="test-bucket",
        artifact_access_key="test-key",
        artifact_secret_key="test-secret",
        workspace_roots=(),
    )
    service = TaskService(configured)

    def unexpected(*_args):
        raise AssertionError("scratch must not resolve an S3 repository pointer")

    monkeypatch.setattr(service.artifacts, "resolve_workspace", unexpected)
    assert service._plan("Explore an idea", "scratch")["workspace"] == "scratch"


def test_missing_named_repository_does_not_become_scratch(tmp_path: Path) -> None:
    service = TaskService(settings(tmp_path))
    with pytest.raises(ValueError, match="choose 'scratch'"):
        service._plan("Explore an idea", str(tmp_path / "missing"))


def test_durable_trace_context_keeps_only_bounded_w3c_fields() -> None:
    assert bounded_trace_context(
        {
            "traceparent": "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01",
            "tracestate": "vendor=value",
            "baggage": "private=value",
        }
    ) == {
        "traceparent": "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01",
        "tracestate": "vendor=value",
    }
    assert bounded_trace_context({"traceparent": "x" * 513}) == {}
