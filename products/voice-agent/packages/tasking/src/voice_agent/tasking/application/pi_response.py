"""Extract a safe, user-facing task response from Pi's JSON event stream."""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass

MAX_RESPONSE_LENGTH = 70_000
MAX_SPOKEN_LENGTH = 2_000
MERMAID_URI = "ui://mermaid/main"
EXCALIDRAW_URI = "ui://excalidraw/mcp-app.html"
EXCALIDRAW_TYPES = {
    "cameraUpdate", "rectangle", "ellipse", "diamond", "text", "arrow", "line"
}

PRESENTATION_INSTRUCTION = """

When the work is complete, make your final assistant message exactly one JSON object
with fields "spoken" and "presentation". "spoken" must be a concise, precise summary
suitable for text-to-speech. "presentation" must contain "kind" ("flow" or "status"),
a short "title", "nodes" with unique "id" and "label" strings, and "edges" with
"from", "to", and optional "label" strings. When the user explicitly requests a
rich, editable, or Excalidraw diagram, use kind "excalidraw" with a title and at
most 80 cameraUpdate, rectangle, ellipse, diamond, text, arrow, or line elements.
Do not use Markdown fences.
""".strip()


@dataclass(frozen=True)
class PiResponse:
    text: str
    spoken: str
    presentation: dict[str, object]
    resource_uri: str


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


def fallback_presentation(spoken: str) -> dict[str, object]:
    label = " ".join(spoken.split()) or "Task completed"
    return {
        "kind": "status",
        "title": "Task result",
        "nodes": [{"id": "result", "label": label[:240]}],
        "edges": [],
    }


def response_from_text(text: str) -> PiResponse:
    text = text.strip()[:MAX_RESPONSE_LENGTH]
    try:
        payload = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        payload = None

    if isinstance(payload, dict):
        spoken_value = payload.get("spoken")
        spoken = spoken_value.strip() if isinstance(spoken_value, str) else ""
        presentation_value = payload.get("presentation")
        presentation = presentation_value if isinstance(presentation_value, dict) else None
    else:
        spoken = text
        presentation = None

    spoken = (spoken or "Task completed.")[:MAX_SPOKEN_LENGTH]
    if presentation and presentation.get("kind") == "excalidraw":
        elements = presentation.get("elements")
        valid_elements = (
            isinstance(elements, list)
            and 0 < len(elements) <= 80
            and all(
                isinstance(element, dict)
                and element.get("type") in EXCALIDRAW_TYPES
                for element in elements
            )
            and len(json.dumps(presentation, separators=(",", ":")).encode()) <= 64 * 1024
        )
        if not valid_elements:
            presentation = None
    if not presentation or presentation.get("kind") not in {"flow", "status", "excalidraw"}:
        presentation = fallback_presentation(spoken)
    resource_uri = (
        EXCALIDRAW_URI
        if presentation.get("kind") == "excalidraw"
        else MERMAID_URI
    )
    return PiResponse(
        text=text or spoken,
        spoken=spoken,
        presentation=presentation,
        resource_uri=resource_uri,
    )


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
