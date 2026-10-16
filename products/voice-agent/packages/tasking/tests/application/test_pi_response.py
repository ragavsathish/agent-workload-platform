import json
from io import StringIO

import pytest
from voice_agent.tasking.application.pi_response import parse_pi_event_stream, response_from_text


def event(value: dict) -> str:
    return json.dumps(value) + "\n"


def test_extracts_authoritative_final_message_after_tool_activity() -> None:
    stream = StringIO(
        event({"type": "message_end", "message": {"role": "assistant", "content": [
            {"type": "toolCall", "name": "gondolin_bash"}
        ]}})
        + event({"type": "message_update", "assistantMessageEvent": {
            "type": "thinking_delta", "delta": "private"
        }})
        + event({"type": "message_end", "message": {"role": "assistant", "content": [
            {"type": "text", "text": json.dumps({
                "spoken": "Tests pass.",
                "presentation": {
                    "kind": "flow",
                    "title": "Verification",
                    "nodes": [{"id": "tests", "label": "Tests pass"}],
                    "edges": [],
                },
            })}
        ]}})
        + event({"type": "agent_settled"})
    )

    response = parse_pi_event_stream(stream)

    assert response.spoken == "Tests pass."
    assert response.presentation["title"] == "Verification"
    assert response.resource_uri == "ui://mermaid/main"
    assert "private" not in response.text


def test_routes_valid_excalidraw_response_to_the_excalidraw_app() -> None:
    response = response_from_text(json.dumps({
        "spoken": "Editable diagram ready.",
        "presentation": {
            "kind": "excalidraw",
            "title": "Task path",
            "elements": [
                {"type": "cameraUpdate", "x": 0, "y": 0, "width": 800, "height": 600},
                {"type": "rectangle", "id": "task", "x": 100, "y": 100,
                 "width": 180, "height": 80, "label": {"text": "Task"}},
            ],
        },
    }))

    assert response.presentation["kind"] == "excalidraw"
    assert response.resource_uri == "ui://excalidraw/mcp-app.html"


def test_plain_response_gets_safe_presentation_fallback() -> None:
    response = response_from_text('Completed <unsafe> "work".')

    assert response.spoken == 'Completed <unsafe> "work".'
    assert response.presentation["kind"] == "status"
    assert response.presentation["nodes"][0]["label"] == 'Completed <unsafe> "work".'


def test_rejects_incomplete_event_stream() -> None:
    with pytest.raises(RuntimeError, match="agent_settled"):
        parse_pi_event_stream(StringIO(event({"type": "agent_start"})))
