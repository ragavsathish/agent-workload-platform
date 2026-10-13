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
                "mermaid": "flowchart TD\n  code --> tests --> done",
            })}
        ]}})
        + event({"type": "agent_settled"})
    )

    response = parse_pi_event_stream(stream)

    assert response.spoken == "Tests pass."
    assert response.mermaid == "flowchart TD\n  code --> tests --> done"
    assert "private" not in response.text


def test_plain_response_gets_safe_mermaid_fallback() -> None:
    response = response_from_text('Completed <unsafe> "work".')

    assert response.spoken == 'Completed <unsafe> "work".'
    assert "&lt;unsafe&gt;" in response.mermaid
    assert "&quot;work&quot;" in response.mermaid


def test_rejects_incomplete_event_stream() -> None:
    with pytest.raises(RuntimeError, match="agent_settled"):
        parse_pi_event_stream(StringIO(event({"type": "agent_start"})))
