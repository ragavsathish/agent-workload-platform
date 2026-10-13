import importlib
import sys
from dataclasses import replace

from fastapi.testclient import TestClient


def load_gateway(monkeypatch):
    monkeypatch.setenv("AGENT_GATEWAY_ENV_FILE", "/nonexistent/pipecat-test.env")
    monkeypatch.setenv("AGENT_GATEWAY_TOKEN", "g" * 32)
    monkeypatch.setenv("DATABASE_URL", "postgresql://test.invalid/test")
    monkeypatch.setenv("ORCHESTRATOR_APPROVAL_SECRET", "a" * 32)
    monkeypatch.setenv("ORCHESTRATOR_WORKSPACE_ROOTS", "/tmp")
    monkeypatch.setenv("ORCHESTRATOR_ALLOWED_USERS", "owner@example.com")
    sys.modules.pop("agent_gateway", None)
    return importlib.import_module("agent_gateway")


def test_health_requires_the_separate_gateway_capability(monkeypatch):
    gateway = load_gateway(monkeypatch)
    client = TestClient(gateway.app)

    assert client.get("/health").status_code == 401
    assert client.get(
        "/health", headers={"Authorization": f"Bearer {'g' * 32}"}
    ).json() == {"status": "ok"}


def test_voice_view_never_returns_host_approval_token_or_raw_events(monkeypatch):
    gateway = load_gateway(monkeypatch)

    view = gateway.voice_view(
        {
            "approval_token": "host-only",
            "status": "pending",
            "result": {
                "state": "completed",
                "result": {
                    "exit_code": 0,
                    "stdout": "private raw output",
                    "response": {
                        "spoken": "Done.",
                        "mermaid": "flowchart TD\n  task --> done",
                    },
                },
            },
        }
    )

    assert "approval_token" not in view
    assert "private raw output" not in str(view)
    assert view["result"]["result"]["response"]["spoken"] == "Done."


def test_gateway_capability_is_bound_to_one_configured_identity(monkeypatch):
    gateway = load_gateway(monkeypatch)

    assert gateway.normalized_identity("Owner@Example.com") == "owner@example.com"

    setattr(
        gateway,
        "settings",
        replace(gateway.settings, allowed_users=("one@example.com", "two@example.com")),
    )
    try:
        gateway.normalized_identity("one@example.com")
    except gateway.HTTPException as exc:
        assert exc.status_code == 503
    else:
        raise AssertionError("multi-user gateway should fail closed")
