"""Extract a safe, user-facing task response from Pi's JSON event stream."""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass

MAX_RESPONSE_LENGTH = 70_000
MAX_SPOKEN_LENGTH = 2_000
MERMAID_URI = "ui://mermaid/main"
EXCALIDRAW_URI = "ui://excalidraw/mcp-app.html"
MARP_URI = "ui://slides/marp.html"
EXCALIDRAW_TYPES = {
    "cameraUpdate", "rectangle", "ellipse", "diamond", "text", "arrow", "line"
}

PRESENTATION_INSTRUCTION = """

Before your first tool call, write one brief public sentence beginning with "Progress: ".
Write another such sentence when you move to a new phase or evidence changes your approach.
Describe what you are checking and why in plain language. These sentences are for the user's
live narration; do not include private reasoning, sensitive details, raw tool output, or a
command transcript.
The final assistant message must still follow the JSON format below.

When the work is complete, make your final assistant message exactly one JSON object
with fields "spoken" and "presentation". "spoken" must be a concise, precise summary
suitable for text-to-speech. Give a useful account of the work in four to eight
sentences: the goal, the main steps and relevant safe commands, why you chose the approach,
what the checks showed, and any remaining uncertainty. Describe observable
decisions and evidence without quoting private reasoning or internal scratch work.
"presentation" must contain "kind" ("flow" or "status"),
a short "title", "nodes" with unique "id" and "label" strings, and "edges" with
"from", "to", and optional "label" strings. When the user explicitly requests a
rich, editable, or Excalidraw diagram, use kind "excalidraw" with a title and at
most 80 cameraUpdate, rectangle, ellipse, diamond, text, arrow, or line elements.
Only when the user explicitly requests slides, a slide deck, or a presentation,
use kind "slides" with a title and at most 64 KiB of Marp Markdown in "markdown".
Separate slides with `---`; Marp slides may contain fenced Mermaid diagrams. In
Mermaid fences, use node IDs with bracket labels, one statement per line, and no
prose punctuation such as a trailing period on a statement.
If editable or whiteboard output is requested, use Excalidraw instead. Do not
wrap the final JSON object in a Markdown fence.
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
    payload: object = text
    for _ in range(4):
        if isinstance(payload, dict):
            nested = payload.get("spoken")
            if not isinstance(nested, str):
                break
            try:
                nested_payload = json.loads(nested)
            except (json.JSONDecodeError, TypeError):
                break
            if not isinstance(nested_payload, dict) or not isinstance(
                nested_payload.get("presentation"), dict
            ):
                break
            payload = nested_payload
            continue
        if not isinstance(payload, str):
            break
        try:
            payload = json.loads(payload)
        except (json.JSONDecodeError, TypeError):
            payload = None
            break

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
    if presentation and presentation.get("kind") == "slides":
        markdown = presentation.get("markdown")
        if (
            not isinstance(markdown, str)
            or not markdown.strip()
            or len(markdown.encode()) > 64 * 1024
        ):
            presentation = None
        else:
            presentation = {**presentation, "markdown": markdown.strip()}
    if not presentation or presentation.get("kind") not in {
        "flow", "status", "excalidraw", "slides"
    }:
        presentation = fallback_presentation(spoken)
    kind = presentation.get("kind")
    if kind == "excalidraw":
        resource_uri = EXCALIDRAW_URI
    elif kind == "slides":
        resource_uri = MARP_URI
    else:
        resource_uri = MERMAID_URI
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
