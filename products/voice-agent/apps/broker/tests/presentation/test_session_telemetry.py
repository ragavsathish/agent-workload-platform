import asyncio
import os
from contextlib import contextmanager
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException, Request

os.environ.setdefault("INFERENCE_BROKER_TOKEN", "x" * 32)
os.environ.setdefault("OLLAMA_MODEL", "test-model")
os.environ.setdefault("ORCHESTRATOR_ALLOWED_USERS", "owner@example.test")
os.environ.setdefault("AGENT_GATEWAY_TOKEN", "y" * 32)

from voice_agent.speech.presentation import http  # noqa: E402


def test_task_narration_forwards_bounded_events_to_separate_pi_endpoint(monkeypatch) -> None:
    operations: list[str] = []
    observed: dict[str, object] = {}

    @contextmanager
    def observe(operation: str):
        operations.append(operation)
        yield

    def handler(request: httpx.Request) -> httpx.Response:
        observed["path"] = request.url.path
        observed["body"] = request.content
        return httpx.Response(200, request=request, json={"spoken": "Reviewing the changes."})

    monkeypatch.setattr(http, "telemetry", SimpleNamespace(observe=observe))

    async def call():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            request = Request({
                "type": "http",
                "app": SimpleNamespace(state=SimpleNamespace(http=client)),
            })
            return await http.pi_task_narration(
                http.TaskNarrationRequest(
                    taskId="00000000-0000-0000-0000-000000000001",
                    instruction="Review the pull request",
                    events=["The agent is reading README.md."],
                ),
                request,
            )

    result = asyncio.run(call())

    assert result == {"spoken": "Reviewing the changes."}
    assert observed["path"] == "/v1/tasks/narration"
    assert b"The agent is reading README.md." in observed["body"]
    assert operations == ["inference.pi.task-narration"]


def response(request: httpx.Request) -> httpx.Response:
    resumed = request.url.path.endswith("/resume")
    return httpx.Response(
        200 if resumed else 201,
        request=request,
        json={"id": "persisted-session"} if resumed else {"activeSessionId": "fresh-session"},
    )


def test_new_session_observes_the_broker_to_pi_hop(monkeypatch) -> None:
    operations: list[str] = []

    @contextmanager
    def observe(operation: str):
        operations.append(operation)
        yield

    monkeypatch.setattr(http, "telemetry", SimpleNamespace(observe=observe))

    async def request():
        async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
            return await http._pi_sessions_request(
                client,
                "/new",
                "POST",
                operation="inference.pi.sessions.new",
            )

    result = asyncio.run(request())

    assert result.status_code == 201
    assert result.body == b'{"activeSessionId":"fresh-session"}'
    assert operations == ["inference.pi.sessions.new"]


def test_resume_session_observes_the_broker_to_pi_hop(monkeypatch) -> None:
    operations: list[str] = []

    @contextmanager
    def observe(operation: str):
        operations.append(operation)
        yield

    monkeypatch.setattr(http, "telemetry", SimpleNamespace(observe=observe))

    async def request():
        async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
            return await http._pi_sessions_request(
                client,
                "/persisted-session/resume",
                "POST",
                operation="inference.pi.sessions.resume",
            )

    result = asyncio.run(request())

    assert result.status_code == 200
    assert result.body == b'{"id":"persisted-session"}'
    assert operations == ["inference.pi.sessions.resume"]


def test_busy_new_session_is_an_observed_error(monkeypatch) -> None:
    outcomes: list[str] = []

    @contextmanager
    def observe(_operation: str):
        try:
            yield
        except BaseException:
            outcomes.append("error")
            raise
        else:
            outcomes.append("ok")

    def busy(request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, request=request, json={"detail": "Pi is busy"})

    monkeypatch.setattr(http, "telemetry", SimpleNamespace(observe=observe))

    async def request() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(busy)) as client:
            with pytest.raises(HTTPException) as raised:
                await http._pi_sessions_request(
                    client,
                    "/new",
                    "POST",
                    operation="inference.pi.sessions.new",
                )
            assert raised.value.status_code == 409

    asyncio.run(request())
    assert outcomes == ["error"]
