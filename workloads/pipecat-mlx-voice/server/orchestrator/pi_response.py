"""Extract a safe, user-facing response from Pi's JSON event stream."""

from __future__ import annotations

import html
import json
import re
from collections.abc import Iterable
from dataclasses import dataclass

MAX_DIAGRAM_LENGTH = 24_000
MAX_RESPONSE_LENGTH = 12_000
MAX_SPOKEN_LENGTH = 2_000

_MERMAID_PREFIX = re.compile(
    r"^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|"
    r"erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|xychart-beta)\b"
)

PRESENTATION_INSTRUCTION = """

When the work is complete, make your final assistant message exactly one JSON object
with two string fields: "spoken" and "mermaid". "spoken" must be a concise, precise
summary suitable for text-to-speech. "mermaid" must be a valid, compact Mermaid
diagram describing the result. Do not use Markdown fences around the JSON or diagram.
""".strip()


@dataclass(frozen=True)
class PiResponse:
    text: str
    spoken: str
    mermaid: str


def presentation_prompt(instruction: str) -> str:
    return f"{instruction.rstrip()}\n\n{PRESENTATION_INSTRUCTION}"


def _message_text(message: object) -> str:
    if not isinstance(message, dict) or message.get("role") != "assistant":
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    if not isinstance(content, list):
        return ""
    parts = [
        item["text"]
        for item in content
        if isinstance(item, dict)
        and item.get("type") == "text"
        and isinstance(item.get("text"), str)
    ]
    return "".join(parts).strip()


def fallback_mermaid(spoken: str) -> str:
    label = " ".join(spoken.split()) or "Task completed"
    label = html.escape(label[:240], quote=True)
    return f'flowchart TD\n  task["Pi task"] --> result["{label}"]'


def response_from_text(text: str) -> PiResponse:
    text = text.strip()[:MAX_RESPONSE_LENGTH]
    try:
        payload = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        payload = None

    if isinstance(payload, dict):
        spoken_value = payload.get("spoken")
        mermaid_value = payload.get("mermaid")
        spoken = spoken_value.strip() if isinstance(spoken_value, str) else ""
        mermaid = mermaid_value.strip() if isinstance(mermaid_value, str) else ""
    else:
        spoken = text
        mermaid = ""

    spoken = (spoken or "Task completed.")[:MAX_SPOKEN_LENGTH]
    if (
        not mermaid
        or len(mermaid) > MAX_DIAGRAM_LENGTH
        or _MERMAID_PREFIX.match(mermaid) is None
    ):
        mermaid = fallback_mermaid(spoken)
    return PiResponse(text=text or spoken, spoken=spoken, mermaid=mermaid)


def parse_pi_event_stream(stream: Iterable[str | bytes]) -> PiResponse:
    """Read JSONL through ``agent_settled`` and return the final assistant message."""
    final_text = ""
    settled = False
    for line in stream:
        try:
            event = json.loads(line)
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(event, dict):
            continue
        if event.get("type") == "message_end":
            candidate = _message_text(event.get("message"))
            if candidate:
                final_text = candidate
        elif event.get("type") == "agent_settled":
            settled = True
    if not settled:
        raise RuntimeError("Pi event stream ended before agent_settled")
    if not final_text:
        raise RuntimeError("Pi event stream contained no final assistant message")
    return response_from_text(final_text)
