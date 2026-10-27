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
    assert client.get("/health", headers={"Authorization": f"Bearer {'g' * 32}"}).json() == {
        "status": "ok"
    }


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


def test_tasks_can_be_queried_by_exact_session_name(monkeypatch):
    gateway = load_gateway(monkeypatch)
    observed = {}

    class Tasks:
        def list(self, **kwargs):
            observed.update(kwargs)
            return [{"id": "proposal-1", "session_name": "Kind of Blue · Take 2"}]

    monkeypatch.setattr(gateway, "service", lambda: Tasks())
    client = TestClient(gateway.app)
    response = client.get(
        "/v1/tasks",
        params={
            "identity": "owner@example.com",
            "session_name": "Kind of Blue · Take 2",
        },
        headers={"Authorization": f"Bearer {'g' * 32}"},
    )

    assert response.status_code == 200
    assert response.json()[0]["session_name"] == "Kind of Blue · Take 2"
    assert observed == {
        "identity": "owner@example.com",
        "limit": 50,
        "session_name": "Kind of Blue · Take 2",
    }


def test_task_list_reports_owner_outage_as_service_unavailable(monkeypatch):
    gateway = load_gateway(monkeypatch)

    class UnavailableTasks:
        def list(self, **_kwargs):
            raise RuntimeError("Pi Durable owner is unavailable")

    monkeypatch.setattr(gateway, "service", lambda: UnavailableTasks())
    client = TestClient(gateway.app)
    response = client.get(
        "/v1/tasks",
        params={"identity": "owner@example.com"},
        headers={"Authorization": f"Bearer {'g' * 32}"},
    )

    assert response.status_code == 503
    assert response.json() == {"detail": "Pi Durable task owner is unavailable"}


def test_task_progress_requires_owner_identity_and_forwards_cursor(monkeypatch):
    gateway = load_gateway(monkeypatch)
    observed = {}

    class Tasks:
        def progress(self, **kwargs):
            observed.update(kwargs)
            return [{"id": 7, "spoken": "The agent is reading source files."}]

    monkeypatch.setattr(gateway, "service", lambda: Tasks())
    client = TestClient(gateway.app)
    path = "/v1/tasks/proposal-1/progress"
    headers = {"Authorization": f"Bearer {'g' * 32}"}

    assert client.get(path, params={"identity": "owner@example.com"}).status_code == 401
    response = client.get(
        path, params={"identity": "owner@example.com", "after": 6}, headers=headers
    )
    assert response.status_code == 200
    assert response.json()[0]["id"] == 7
    assert observed == {
        "identity": "owner@example.com",
        "proposal_id": "proposal-1",
        "after": 6,
        "limit": 40,
    }


def test_task_artifact_download_requires_owner_and_returns_attachment(monkeypatch):
    gateway = load_gateway(monkeypatch)
    observed = {}

    class Tasks:
        def artifact(self, **kwargs):
            observed.update(kwargs)
            return b"workspace data", "workspace.zip", "application/zip"

    monkeypatch.setattr(gateway, "service", lambda: Tasks())
    client = TestClient(gateway.app)
    path = "/v1/tasks/proposal-1/artifacts/workspace"
    headers = {"Authorization": f"Bearer {'g' * 32}"}

    assert client.get(path, params={"identity": "owner@example.com"}).status_code == 401
    response = client.get(path, params={"identity": "owner@example.com"}, headers=headers)
    assert response.status_code == 200
    assert response.content == b"workspace data"
    assert response.headers["content-disposition"] == 'attachment; filename="workspace.zip"'
    assert response.headers["cache-control"] == "private, no-store"
    assert observed == {
        "identity": "owner@example.com",
        "proposal_id": "proposal-1",
        "name": "workspace",
    }
    assert (
        client.get(
            "/v1/tasks/proposal-1/artifacts/execution",
            params={"identity": "owner@example.com"},
            headers=headers,
        ).status_code
        == 422
    )


def test_task_approval_passes_trace_context_to_the_durable_queue(monkeypatch):
    gateway = load_gateway(monkeypatch)
    observed = {}

    class Tasks:
        def get(self, **_kwargs):
            return {"approval_token": "approved-token"}

        def approve(self, **kwargs):
            observed.update(kwargs)
            return {"id": "proposal-1", "status": "approved", "task_id": "task-1"}

    monkeypatch.setattr(gateway, "service", lambda: Tasks())
    monkeypatch.setattr(
        gateway,
        "inject",
        lambda carrier: carrier.update(
            {"traceparent": ("00-1234567890abcdef1234567890abcdef-1234567890abcdef-01")}
        ),
    )
    client = TestClient(gateway.app)

    response = client.post(
        "/v1/tasks/proposal-1/approve",
        json={"identity": "owner@example.com"},
        headers={"Authorization": f"Bearer {'g' * 32}"},
    )

    assert response.status_code == 200
    assert observed["trace_context"] == {
        "traceparent": "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01"
    }


def test_song_creation_is_authenticated_and_enqueues_lyrics_before_render(monkeypatch):
    gateway = load_gateway(monkeypatch)
    observed = {}

    class Songs:
        def create(self, **kwargs):
            observed.update(kwargs)
            return {
                "id": "generation-1",
                "status": "writing_lyrics",
                "lyrics_task_id": "task-1",
            }

    monkeypatch.setattr(gateway, "songs", lambda: Songs())
    monkeypatch.setattr(
        gateway,
        "inject",
        lambda carrier: carrier.update(
            {"traceparent": "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01"}
        ),
    )
    client = TestClient(gateway.app)
    body = {
        "identity": "owner@example.com",
        "brief": "Turn the current pull request into a song.",
        "workspace": "/tmp",
        "style": "Warm R&B",
        "durationSeconds": 120,
    }

    assert client.post("/v1/music/generations", json=body).status_code == 401
    response = client.post(
        "/v1/music/generations",
        json=body,
        headers={"Authorization": f"Bearer {'g' * 32}"},
    )

    assert response.status_code == 202
    assert response.json()["status"] == "writing_lyrics"
    assert observed["brief"] == body["brief"]
    assert observed["duration_seconds"] == 120
    assert "traceparent" in observed["trace_context"]


def test_song_render_requires_a_separate_review_command(monkeypatch):
    gateway = load_gateway(monkeypatch)
    observed = {}

    class Songs:
        def render(self, **kwargs):
            observed.update(kwargs)
            return {"id": "generation-1", "status": "generating_music"}

    monkeypatch.setattr(gateway, "songs", lambda: Songs())
    client = TestClient(gateway.app)
    response = client.post(
        "/v1/music/generations/generation-1/render",
        json={"identity": "owner@example.com"},
        headers={"Authorization": f"Bearer {'g' * 32}"},
    )

    assert response.status_code == 202
    assert response.json()["status"] == "generating_music"
    assert observed["generation_id"] == "generation-1"


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
    assert client.get(path, headers={"Authorization": f"Bearer {'g' * 32}"}).status_code == 401
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
        return [
            {
                "kind": "idea",
                "label": "Keep memories separate from accepted facts.",
                "source": "urn:awp:digital-twin:journal:capture-1:entry:1",
            }
        ]

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
            return {
                "tasks": {
                    "journal": {"task_id": "task-1"},
                    "classify": {"task_id": "task-2"},
                }
            }

    monkeypatch.setattr(gateway, "service", lambda: Tasks())
    client = TestClient(gateway.app)
    assert (
        client.post(
            "/v1/digital-twin/ingestions",
            headers={"Authorization": f"Bearer {'r' * 32}"},
            json={
                "identity": "owner@example.com",
                "sessionId": "session-7",
                "messageId": "user-3",
                "transcript": "I want ingestion to be durable.",
                "capturedAt": "2026-10-17T10:00:00Z",
            },
        ).status_code
        == 401
    )
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
    assert response.json()["tasks"] == {
        "journal": {"task_id": "task-1"},
        "classify": {"task_id": "task-2"},
    }
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
        "entries": [
            {
                "id": f"{'a' * 32}:entry:1",
                "type": "idea",
                "text": "Use a narrow writer.",
                "topics": ["capability security"],
            }
        ],
    }

    assert (
        client.post(
            "/v1/digital-twin/journal",
            headers={"Authorization": f"Bearer {'g' * 32}"},
            json=capture,
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/v1/digital-twin/journal",
            headers={"Authorization": f"Bearer {'r' * 32}"},
            json=capture,
        ).status_code
        == 401
    )
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


def test_journal_feedback_updates_private_review_state(monkeypatch):
    gateway = load_gateway(monkeypatch)
    updates = []
    monkeypatch.setattr(
        gateway,
        "_sparql_rows",
        lambda _query: [{"kind": "idea", "label": "Original", "status": "unreviewed"}],
    )
    monkeypatch.setattr(gateway, "_sparql_update", updates.append)
    client = TestClient(gateway.app)
    entry_id = f"{'a' * 32}:entry:1"

    response = client.post(
        f"/v1/digital-twin/journal/{entry_id}/feedback",
        headers={"Authorization": f"Bearer {'g' * 32}"},
        json={
            "identity": "owner@example.com",
            "action": "wrong_type",
            "correctedType": "thought",
        },
    )

    assert response.status_code == 200
    assert response.json()["entryId"] == entry_id
    assert response.json()["action"] == "wrong_type"
    assert len(response.json()["feedbackId"]) == 32
    assert len(updates) == 1
    assert "GRAPH <urn:awp:digital-twin:graph:journal-feedback>" in updates[0]
    assert 'awp:previousType "idea"' in updates[0]
    assert 'awp:correctedType "thought"' in updates[0]


def test_journal_edit_replaces_topics_and_escapes_slash_as_sparql_literal(monkeypatch):
    gateway = load_gateway(monkeypatch)
    updates = []
    monkeypatch.setattr(
        gateway, "_sparql_rows", lambda _query: [{"kind": "idea", "label": "Original"}]
    )
    monkeypatch.setattr(gateway, "_sparql_update", updates.append)
    entry_id = f"{'a' * 32}:entry:1"
    response = TestClient(gateway.app).post(
        f"/v1/digital-twin/journal/{entry_id}/feedback",
        headers={"Authorization": f"Bearer {'g' * 32}"},
        json={
            "identity": "owner@example.com",
            "action": "edit",
            "correctedText": "A/B",
            "correctedType": "thought",
            "correctedTopics": ["Learning", "Graph"],
        },
    )
    assert response.status_code == 200
    assert 'schema:text "A/B"' in updates[0]
    assert "schema:keywords ?oldTopic" in updates[0]
    assert 'schema:keywords "Learning"' in updates[0]
    assert 'schema:keywords "Graph"' in updates[0]


def test_assertion_review_stays_in_separate_graph_and_requires_owner_authorship(monkeypatch):
    gateway = load_gateway(monkeypatch)
    updates = []
    monkeypatch.setattr(
        gateway,
        "_sparql_rows",
        lambda query: (
            [{"kind": "idea"}]
            if "SELECT ?kind ?label ?status" in query
            else [
                {
                    "ownerAuthored": "true",
                    "expectedKind": "skill_evidence",
                    "reason": "Verified owner turn",
                }
            ]
        ),
    )
    monkeypatch.setattr(gateway, "_sparql_update", updates.append)
    client = TestClient(gateway.app)
    path = f"/v1/digital-twin/journal/{'a' * 32}:entry:1/assertion-review"
    headers = {"Authorization": f"Bearer {'g' * 32}"}
    invalid = client.post(
        path,
        headers=headers,
        json={
            "identity": "owner@example.com",
            "ownerAuthored": False,
            "expectedKind": "skill_evidence",
            "reason": "Not owner",
        },
    )
    assert invalid.status_code == 422
    saved = client.post(
        path,
        headers=headers,
        json={
            "identity": "owner@example.com",
            "ownerAuthored": True,
            "expectedKind": "skill_evidence",
            "reason": "Verified owner turn",
        },
    )
    assert saved.status_code == 200
    assert len(updates) == 1
    assert "graph:assertion-feedback" in updates[0]
    assert "graph:journal>" not in updates[0]
    read = client.get(path + "?identity=owner@example.com", headers=headers)
    assert read.status_code == 200
    assert read.json()["review"]["expectedKind"] == "skill_evidence"


def test_journal_feedback_validates_corrections_and_records_misses(monkeypatch):
    gateway = load_gateway(monkeypatch)
    updates = []
    monkeypatch.setattr(gateway, "_sparql_update", updates.append)
    client = TestClient(gateway.app)
    entry_id = f"{'b' * 32}:entry:1"
    headers = {"Authorization": f"Bearer {'g' * 32}"}

    assert (
        client.post(
            f"/v1/digital-twin/journal/{entry_id}/feedback",
            headers=headers,
            json={"identity": "owner@example.com", "action": "edit"},
        ).status_code
        == 422
    )

    response = client.post(
        "/v1/digital-twin/journal/misses",
        headers=headers,
        json={
            "identity": "owner@example.com",
            "captureId": "c" * 32,
            "expectedType": "learning",
            "expectedText": "Stable identifiers make retries idempotent.",
        },
    )
    assert response.status_code == 200
    assert response.json()["action"] == "missed"
    assert "journal-feedback" in updates[0]
    assert 'schema:actionStatus "missed"' in updates[0]


def test_journal_feedback_export_uses_reader_capability(monkeypatch):
    gateway = load_gateway(monkeypatch)
    monkeypatch.setattr(
        gateway,
        "_sparql_rows",
        lambda query: (
            [{"id": "feedback-1", "action": "keep"}]
            if query == gateway.JOURNAL_FEEDBACK_QUERY
            else []
        ),
    )
    client = TestClient(gateway.app)
    path = "/v1/digital-twin/journal/feedback?identity=owner@example.com"

    assert client.get(path).status_code == 401
    response = client.get(path, headers={"Authorization": f"Bearer {'r' * 32}"})
    assert response.status_code == 200
    assert response.json() == {"feedback": [{"id": "feedback-1", "action": "keep"}]}


def test_classifier_candidates_are_written_only_to_the_review_graph(monkeypatch):
    gateway = load_gateway(monkeypatch)
    observed = []
    monkeypatch.setattr(gateway, "_sparql_update", observed.append)
    client = TestClient(gateway.app)
    capture_id = "b" * 32
    candidate_id = f"{capture_id}:candidate:1"
    response = client.post(
        "/v1/digital-twin/reviews",
        headers={"Authorization": f"Bearer {'w' * 32}"},
        json={
            "id": capture_id,
            "identity": "owner@example.com",
            "sourceRef": "pi-session:session-8:user-4",
            "capturedAt": "2026-10-17T10:00:00Z",
            "classification": {
                "kind": "skill_evidence",
                "confidence": 0.91,
                "probabilities": {
                    "conversation_topic": 0.0,
                    "skill_evidence": 0.91,
                    "profile_update": 0.0,
                    "none": 0.09,
                },
                "profileField": "none",
                "profileFieldConfidence": 0.99,
                "lowConfidence": False,
                "model": "Cloudflare/clef-flash",
            },
            "candidates": [
                {
                    "id": candidate_id,
                    "label": "Playwright",
                    "evidenceQuote": "I use Playwright.",
                }
            ],
        },
    )

    assert response.status_code == 200
    assert response.json() == {"captureId": capture_id, "candidates": 1}
    assert len(observed) == 1
    assert "GRAPH <urn:awp:digital-twin:graph:review>" in observed[0]
    assert "graph:accepted" not in observed[0]
    assert candidate_id in observed[0]


def test_owner_can_accept_a_pending_candidate_into_the_accepted_graph(monkeypatch):
    gateway = load_gateway(monkeypatch)
    updates = []
    candidate_id = f"{'c' * 32}:candidate:1"

    def query(query):
        assert candidate_id in query
        return [
            {
                "kind": "skill_evidence",
                "label": "Playwright",
                "evidence": "I use Playwright.",
                "status": "pending",
            }
        ]

    monkeypatch.setattr(gateway, "_sparql_rows", query)
    monkeypatch.setattr(gateway, "_sparql_update", updates.append)
    client = TestClient(gateway.app)
    response = client.post(
        f"/v1/digital-twin/reviews/{candidate_id}",
        headers={"Authorization": f"Bearer {'g' * 32}"},
        json={"identity": "owner@example.com", "decision": "accept"},
    )

    assert response.status_code == 200
    assert response.json() == {"candidateId": candidate_id, "status": "accepted"}
    assert len(updates) == 1
    assert "GRAPH <urn:awp:digital-twin:graph:accepted>" in updates[0]
    assert 'awp:status "accepted"' in updates[0]


def test_reader_can_list_pending_candidates_but_cannot_decide_them(monkeypatch):
    gateway = load_gateway(monkeypatch)
    monkeypatch.setattr(gateway, "_sparql_rows", lambda query: [{"id": "candidate-1"}])
    client = TestClient(gateway.app)

    listed = client.get(
        "/v1/digital-twin/reviews?identity=owner@example.com",
        headers={"Authorization": f"Bearer {'r' * 32}"},
    )
    assert listed.status_code == 200
    assert listed.json() == {"reviews": [{"id": "candidate-1"}]}

    denied = client.post(
        f"/v1/digital-twin/reviews/{'d' * 32}:candidate:1",
        headers={"Authorization": f"Bearer {'r' * 32}"},
        json={"identity": "owner@example.com", "decision": "accept"},
    )
    assert denied.status_code == 401
