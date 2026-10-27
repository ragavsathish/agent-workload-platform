import uuid
from dataclasses import replace
from pathlib import Path

import allure
import pytest
from voice_agent.tasking.application import service as service_module
from voice_agent.tasking.application.service import (
    TaskError,
    TaskService,
    bounded_trace_context,
)
from voice_agent.tasking.infrastructure.config import Settings


def settings(tmp_path: Path) -> Settings:
    return Settings(
        allowed_users=("owner@example.com",),
        workspace_roots=(tmp_path,),
        pi_model=None,
        pi_thinking="medium",
        pi_session_dir=tmp_path / "sessions",
        pi_execution_mode="gondolin",
        max_output_bytes=1_024,
        skills_dir=None,
    )


@allure.epic("Durable work")
@allure.feature("Task execution")
@allure.story("Submit directly to the Pi Durable owner")
def test_submit_creates_one_native_task_without_a_proposal_or_approval(
    tmp_path: Path, monkeypatch
) -> None:
    service = TaskService(settings(tmp_path))
    task_id = "11111111-1111-4111-8111-111111111111"
    calls = []
    native = {
        "task_id": task_id,
        "identity": "owner@example.com",
        "instruction": "Create a file.",
        "workspace": "scratch",
        "session_album_key": "kind-of-blue",
        "session_name": "Kind of Blue · 11111111",
        "created_at": "2026-10-25T12:00:00+00:00",
    }

    def submit(kind, params, request_id):
        calls.append((kind, params, request_id))
        return task_id

    monkeypatch.setattr(service.owner, "submit", submit)
    monkeypatch.setattr(service.owner, "describe", lambda _task_id: native)
    monkeypatch.setattr(
        service.owner,
        "get",
        lambda _task_id: {"state": "pending", "result": None, "failure": None},
    )

    monkeypatch.setattr(service_module.uuid, "uuid4", lambda: uuid.UUID(task_id))
    with allure.step("Given a validated scratch task request from the session"):
        assert task_id
    with allure.step("When the Gateway submits it directly to Pi Durable"):
        view = service.submit(
            identity="owner@example.com",
            instruction="Create a file.",
            workspace="scratch",
        )
    with allure.step("Then one native task ID is returned with no approval state"):
        assert len(calls) == 1
        kind, params, submitted_id = calls[0]
        assert kind == "agent-run"
        assert submitted_id == view["id"]
        assert params["identity"] == "owner@example.com"
        assert params["instruction"] == "Create a file."
        assert params["workspace"] == "scratch"
        assert params["native_cli"] is True
        assert view["status"] == "submitted"
        assert view["task_id"] == view["id"]
        assert view["result"]["state"] == "pending"
        assert "approval_token" not in view


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

    monkeypatch.setattr(service, "artifacts", Store())

    def get_owned(identity, requested_id):
        assert requested_id == task_id
        if identity != "owner@example.com":
            raise TaskError("task not found")
        return {"workspace": workspace, "task_id": task_id}

    monkeypatch.setattr(service, "_get_native_owned", get_owned)
    artifact_uri = f"s3://agent-artifacts/tasks/{task_id}/{filename}"
    monkeypatch.setattr(
        service, "_task_result", lambda _: {"result": {"artifacts": {name: artifact_uri}}}
    )

    assert service.artifact(identity="owner@example.com", task_id=task_id, name=name)[0] == b"artifact"
    with pytest.raises(TaskError, match="task not found"):
        service.artifact(identity="stranger@example.com", task_id=task_id, name=name)
    other_name = "patch" if name == "workspace" else "workspace"
    with pytest.raises(TaskError, match="unavailable"):
        service.artifact(identity="owner@example.com", task_id=task_id, name=other_name)
    monkeypatch.setattr(
        service, "_task_result", lambda _: {"result": {"artifacts": {name: "s3://wrong"}}}
    )
    with pytest.raises(TaskError, match="unavailable"):
        service.artifact(identity="owner@example.com", task_id=task_id, name=name)


def test_digital_twin_turn_uses_retryable_idempotent_pi_durable_tasks(
    tmp_path: Path, monkeypatch
) -> None:
    observed = []
    service = TaskService(settings(tmp_path))
    monkeypatch.setattr(
        service.owner,
        "submit",
        lambda kind, payload, request_id: observed.append(
            {"task": kind, "payload": payload, "request_id": request_id}
        ) or "task-1",
    )
    result = service.enqueue_digital_twin(
        identity="owner@example.com",
        session_id="session-7",
        message_id="user-3",
        transcript="  I want durable memory.  ",
        captured_at="2026-10-17T10:00:00Z",
    )

    assert result["tasks"]["journal"]["task_id"] == "task-1"
    assert [call["task"] for call in observed] == ["digital-twin-journal", "digital-twin-classify"]
    assert all(call["payload"]["transcript"] == "I want durable memory." for call in observed)
    assert [call["request_id"] for call in observed] == [
        str(uuid.uuid5(uuid.NAMESPACE_URL, f"digital-twin:{mode}:session-7:user-3"))
        for mode in ("journal", "classify")
    ]


def test_daily_journal_is_one_idempotent_pi_durable_task(tmp_path: Path, monkeypatch) -> None:
    observed = []
    service = TaskService(settings(tmp_path))
    monkeypatch.setattr(
        service.owner,
        "submit",
        lambda kind, payload, request_id: observed.append((kind, payload, request_id)) or "daily-1",
    )
    sources = [{
        "sourceRef": "session-1:message-1",
        "speaker": "owner",
        "capturedAt": "2026-10-17T10:00:00+03:00",
        "transcript": "I learned to preserve evidence.",
    }]

    result = service.enqueue_daily_journal(
        identity="owner@example.com", journal_date="2026-10-17",
        time_zone="Europe/Helsinki", sources=sources,
    )
    repeated = service.enqueue_daily_journal(
        identity="owner@example.com", journal_date="2026-10-17",
        time_zone="Europe/Helsinki", sources=sources,
    )

    assert result == repeated
    assert observed[0][0] == "digital-twin-daily-journal"
    assert observed[0][1]["mode"] == "daily-journal"
    assert observed[0][1]["sources"] == sources
    assert observed[0][2] == str(uuid.uuid5(uuid.NAMESPACE_URL, result["idempotency_key"]))


def test_native_task_view_checks_owner_and_lists_from_pi_durable(
    tmp_path: Path, monkeypatch
) -> None:
    service = TaskService(settings(tmp_path))
    task_id = "11111111-1111-4111-8111-111111111111"
    native = {
        "task_id": task_id,
        "identity": "owner@example.com",
        "instruction": "Inspect only",
        "workspace": "scratch",
        "session_album_key": "kind-of-blue",
        "session_name": "Kind of Blue · 11111111",
        "created_at": "2026-10-25T12:00:00+00:00",
        "result": {"state": "running", "result": None, "failure": None},
    }
    monkeypatch.setattr(service.owner, "describe", lambda _task_id: native)
    monkeypatch.setattr(service.owner, "get", lambda _task_id: native["result"])
    monkeypatch.setattr(service.owner, "list_native", lambda identity, _limit: [native] if identity == "owner@example.com" else [])

    view = service.get(identity="owner@example.com", task_id=task_id)
    assert view["id"] == task_id
    assert view["status"] == "submitted"
    assert view["result"]["state"] == "running"
    assert view["session_name"] == "Kind of Blue · 11111111"
    assert view["session_reference"]["artist"] == "Miles Davis"
    assert service.list(identity="owner@example.com")[0]["id"] == task_id
    assert service.list(identity="stranger@example.com") == []
    with pytest.raises(TaskError, match="task not found"):
        service.get(identity="stranger@example.com", task_id=task_id)


def test_cancel_aborts_an_owned_native_task(tmp_path: Path, monkeypatch) -> None:
    service = TaskService(settings(tmp_path))
    task_id = "11111111-1111-4111-8111-111111111111"
    native = {
        "task_id": task_id,
        "identity": "owner@example.com",
        "instruction": "Inspect only",
        "workspace": "scratch",
        "created_at": "2026-10-25T12:00:00+00:00",
    }
    calls = []
    monkeypatch.setattr(service.owner, "describe", lambda _task_id: native)
    monkeypatch.setattr(service.owner, "abort", lambda _task_id: calls.append(_task_id) or "marked")
    monkeypatch.setattr(service.owner, "get", lambda _task_id: {"state": "cancelled", "result": None})

    cancelled = service.cancel(identity="owner@example.com", task_id=task_id)
    assert calls == [task_id]
    assert cancelled["result"]["state"] == "cancelled"


def test_scratch_only_configuration_needs_no_repository_allowlist(tmp_path: Path) -> None:
    service = TaskService(replace(settings(tmp_path), workspace_roots=()))
    assert service._plan("  Explore an idea  ", "scratch") == {
        "instruction": "Explore an idea",
        "workspace": "scratch",
    }
    with pytest.raises(TaskError, match="outside"):
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
    with pytest.raises(TaskError, match="choose 'scratch'"):
        service._plan("Explore an idea", str(tmp_path / "missing"))


def test_trace_context_keeps_only_bounded_w3c_fields() -> None:
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
