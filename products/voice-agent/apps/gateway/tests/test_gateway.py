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
    monkeypatch.setenv("OXIGRAPH_QUERY_URL", "http://oxigraph.test:7878/query")
    monkeypatch.setenv("DIGITAL_TWIN_READER_TOKEN", "r" * 32)
    monkeypatch.setenv("DIGITAL_TWIN_WRITER_TOKEN", "w" * 32)
    module = "voice_gateway.main"
    sys.modules.pop(module, None)
    return importlib.import_module(module)


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
                        "presentation": {
                            "kind": "status",
                            "title": "Task result",
                            "nodes": [{"id": "done", "label": "Done"}],
                            "edges": [],
                        },
                        "resourceUri": "ui://mermaid/main",
                    },
                },
            },
        }
    )

    assert "approval_token" not in view
    assert "private raw output" not in str(view)
    assert view["result"]["result"]["response"]["spoken"] == "Done."
    assert view["result"]["result"]["response"]["resourceUri"] == "ui://mermaid/main"


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


def test_digital_twin_query_is_authenticated_identity_bound_and_read_only(monkeypatch):
    gateway = load_gateway(monkeypatch)
    observed_queries = []

    def fixed_query(query):
        observed_queries.append(query)
        return [
            {
                "kind": "learning topic",
                "label": "EventStorming",
                "source": "urn:awp:digital-twin:video:g0047beVND4",
            },
            {
                "kind": "learning topic",
                "label": "Medical device risk management",
                "source": "urn:awp:digital-twin:video:XcdIRDh5Ek8",
            },
        ]

    monkeypatch.setattr(gateway, "_sparql_rows", fixed_query)
    client = TestClient(gateway.app)
    path = "/v1/digital-twin?identity=owner@example.com&scope=learning&query=event"

    assert client.get(path).status_code == 401
    assert client.get(
        path, headers={"Authorization": f"Bearer {'g' * 32}"}
    ).status_code == 401
    response = client.get(path, headers={"Authorization": f"Bearer {'r' * 32}"})

    assert response.status_code == 200
    assert response.json() == {
        "scope": "learning",
        "query": "event",
        "facts": [
            {
                "kind": "learning topic",
                "label": "EventStorming",
                "source": "urn:awp:digital-twin:video:g0047beVND4",
            }
        ],
    }
    assert observed_queries == [gateway.LEARNING_FACTS_QUERY]
    assert "event" not in observed_queries[0].casefold()

    denied = client.get(
        "/v1/digital-twin?identity=intruder@example.com",
        headers={"Authorization": f"Bearer {'r' * 32}"},
    )
    assert denied.status_code == 403


def test_digital_twin_query_exposes_lightweight_journal_scope(monkeypatch):
    gateway = load_gateway(monkeypatch)

    def fixed_query(query):
        assert query == gateway.JOURNAL_FACTS_QUERY
        return [{
            "kind": "idea",
            "label": "Keep memories separate from accepted facts.",
            "source": "urn:awp:digital-twin:journal:capture-1:entry:1",
        }]

    monkeypatch.setattr(gateway, "_sparql_rows", fixed_query)
    client = TestClient(gateway.app)
    response = client.get(
        "/v1/digital-twin?identity=owner@example.com&scope=journal",
        headers={"Authorization": f"Bearer {'r' * 32}"},
    )

    assert response.status_code == 200
    assert response.json()["facts"][0]["kind"] == "idea"


def test_completed_turn_is_enqueued_as_an_idempotent_digital_twin_task(monkeypatch):
    gateway = load_gateway(monkeypatch)
    observed = {}

    class Tasks:
        def enqueue_digital_twin(self, **kwargs):
            observed.update(kwargs)
            return {"task_id": "task-1", "idempotency_key": "digital-twin:session-7:user-3"}

    monkeypatch.setattr(gateway, "service", lambda: Tasks())
    client = TestClient(gateway.app)
    response = client.post(
        "/v1/digital-twin/ingestions",
        headers={"Authorization": f"Bearer {'g' * 32}"},
        json={
            "identity": "owner@example.com",
            "sessionId": "session-7",
            "messageId": "user-3",
            "transcript": "I want ingestion to be durable.",
            "capturedAt": "2026-10-17T10:00:00Z",
        },
    )

    assert response.status_code == 202
    assert response.json()["task_id"] == "task-1"
    assert observed == {
        "identity": "owner@example.com",
        "session_id": "session-7",
        "message_id": "user-3",
        "transcript": "I want ingestion to be durable.",
        "captured_at": "2026-10-17T10:00:00+00:00",
    }


def test_journal_writer_has_a_separate_capability_and_fixed_graph(monkeypatch):
    gateway = load_gateway(monkeypatch)
    observed = []
    monkeypatch.setattr(gateway, "_sparql_update", observed.append)
    client = TestClient(gateway.app)
    capture = {
        "id": "a" * 32,
        "identity": "owner@example.com",
        "sourceRef": "pi-session:session-7:user-3",
        "capturedAt": "2026-10-17T10:00:00Z",
        "transcript": "I prefer a narrow writer.",
        "entries": [{
            "id": f"{'a' * 32}:entry:1",
            "type": "idea",
            "text": "Use a narrow writer.",
            "topics": ["capability security"],
        }],
    }

    assert client.post(
        "/v1/digital-twin/journal",
        headers={"Authorization": f"Bearer {'g' * 32}"},
        json=capture,
    ).status_code == 401
    response = client.post(
        "/v1/digital-twin/journal",
        headers={"Authorization": f"Bearer {'w' * 32}"},
        json=capture,
    )

    assert response.status_code == 200
    assert response.json() == {"captureId": "a" * 32, "entries": 1}
    assert len(observed) == 1
    assert "GRAPH <urn:awp:digital-twin:graph:journal>" in observed[0]
    assert "capability security" in observed[0]
