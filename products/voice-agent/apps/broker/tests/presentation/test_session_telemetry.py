import asyncio
import os
from contextlib import contextmanager
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException

os.environ.setdefault("INFERENCE_BROKER_TOKEN", "x" * 32)
os.environ.setdefault("OLLAMA_MODEL", "test-model")
os.environ.setdefault("ORCHESTRATOR_ALLOWED_USERS", "owner@example.test")
os.environ.setdefault("AGENT_GATEWAY_TOKEN", "y" * 32)

from voice_agent.speech.presentation import http  # noqa: E402


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
