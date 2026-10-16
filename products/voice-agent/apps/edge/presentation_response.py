"""Parse the model's combined spoken and structured presentation response."""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass

MAX_SPOKEN_LENGTH = 2_000
MAX_TITLE_LENGTH = 160
MAX_LABEL_LENGTH = 240
MAX_NODES = 24
MAX_EDGES = 48
MAX_EXCALIDRAW_ELEMENTS = 80
MAX_EXCALIDRAW_BYTES = 64 * 1024
VOICE_CANVAS_URI = "ui://voice-canvas/main"
EXCALIDRAW_URI = "ui://excalidraw/mcp-app.html"
EXCALIDRAW_TYPES = {
    "cameraUpdate", "rectangle", "ellipse", "diamond", "text", "arrow", "line"
}


@dataclass(frozen=True)
class PresentationResponse:
    spoken: str
    presentation: dict[str, object]
    resource_uri: str


class StreamingSpokenExtractor:
    """Incrementally decode the JSON ``spoken`` string from arbitrary text chunks."""

    _ESCAPES = {
        '"': '"',
        "\\": "\\",
        "/": "/",
        "b": "\b",
        "f": "\f",
        "n": "\n",
        "r": "\r",
        "t": "\t",
    }

    def __init__(self) -> None:
        self._prefix = ""
        self._started = False
        self._finished = False
        self._escaped = False
        self._unicode_digits: str | None = None

    @property
    def started(self) -> bool:
        return self._started

    @property
    def finished(self) -> bool:
        return self._finished

    def feed(self, chunk: str) -> str:
        if self._finished or not chunk:
            return ""
        if not self._started:
            self._prefix += chunk
            match = re.search(r'"spoken"\s*:\s*"', self._prefix)
            if match is None:
                self._prefix = self._prefix[-64:]
                return ""
            chunk = self._prefix[match.end():]
            self._prefix = ""
            self._started = True

        decoded: list[str] = []
        for character in chunk:
            if self._unicode_digits is not None:
                self._unicode_digits += character
                if len(self._unicode_digits) == 4:
                    try:
                        decoded.append(chr(int(self._unicode_digits, 16)))
                    except ValueError:
                        decoded.append("�")
                    self._unicode_digits = None
                    self._escaped = False
                continue
            if self._escaped:
                if character == "u":
                    self._unicode_digits = ""
                else:
                    decoded.append(self._ESCAPES.get(character, character))
                    self._escaped = False
                continue
            if character == "\\":
                self._escaped = True
            elif character == '"':
                self._finished = True
                break
            else:
                decoded.append(character)
        return "".join(decoded)


def _strip_code_fence(value: str) -> str:
    value = value.strip()
    if not value.startswith("```"):
        return value
    lines = value.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


def fallback_presentation(spoken: str) -> dict[str, object]:
    label = " ".join(spoken.split()) or "Ready"
    return {
        "kind": "status",
        "title": "Pi response",
        "nodes": [{"id": "result", "label": label[:MAX_LABEL_LENGTH]}],
        "edges": [],
    }


def _normalize_presentation(value: object, spoken: str) -> dict[str, object]:
    if not isinstance(value, dict):
        return fallback_presentation(spoken)
    kind = value.get("kind")
    title = value.get("title")
    raw_nodes = value.get("nodes")
    raw_edges = value.get("edges")
    if kind == "excalidraw":
        return _normalize_excalidraw(value, spoken)
    if kind not in {"flow", "status"} or not isinstance(raw_nodes, list):
        return fallback_presentation(spoken)

    nodes: list[dict[str, str]] = []
    ids: set[str] = set()
    for raw in raw_nodes[:MAX_NODES]:
        if not isinstance(raw, dict):
            continue
        node_id = raw.get("id")
        label = raw.get("label")
        if not isinstance(node_id, str) or not isinstance(label, str):
            continue
        node_id = node_id.strip()[:80]
        label = " ".join(label.split())[:MAX_LABEL_LENGTH]
        if not node_id or not label or node_id in ids:
            continue
        ids.add(node_id)
        nodes.append({"id": node_id, "label": label})
    if not nodes:
        return fallback_presentation(spoken)

    edges: list[dict[str, str]] = []
    if isinstance(raw_edges, list):
        for raw in raw_edges[:MAX_EDGES]:
            if not isinstance(raw, dict):
                continue
            source = raw.get("from")
            target = raw.get("to")
            label = raw.get("label", "")
            if source not in ids or target not in ids or not isinstance(label, str):
                continue
            edges.append({
                "from": source,
                "to": target,
                "label": " ".join(label.split())[:MAX_LABEL_LENGTH],
            })

    return {
        "kind": kind,
        "title": (title.strip()[:MAX_TITLE_LENGTH] if isinstance(title, str) else "Pi response"),
        "nodes": nodes,
        "edges": edges,
    }


def _bounded_json_value(value: object, depth: int = 0) -> object | None:
    if depth > 5:
        return None
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value[:MAX_LABEL_LENGTH]
    if isinstance(value, (int, float)) and math.isfinite(value):
        return max(-10_000, min(10_000, value))
    if isinstance(value, list):
        return [
            bounded
            for item in value[:128]
            if (bounded := _bounded_json_value(item, depth + 1)) is not None
        ]
    if isinstance(value, dict):
        bounded: dict[str, object] = {}
        for key, item in list(value.items())[:32]:
            if not isinstance(key, str) or key.startswith("__"):
                continue
            safe_item = _bounded_json_value(item, depth + 1)
            if safe_item is not None:
                bounded[key[:80]] = safe_item
        return bounded
    return None


def _normalize_excalidraw(value: dict[object, object], spoken: str) -> dict[str, object]:
    raw_elements = value.get("elements")
    if not isinstance(raw_elements, list):
        return fallback_presentation(spoken)
    elements: list[dict[str, object]] = []
    ids: set[str] = set()
    for raw in raw_elements[:MAX_EXCALIDRAW_ELEMENTS]:
        if not isinstance(raw, dict) or raw.get("type") not in EXCALIDRAW_TYPES:
            continue
        safe = _bounded_json_value(raw)
        if not isinstance(safe, dict):
            continue
        element_type = safe.get("type")
        element_id = safe.get("id")
        if element_type != "cameraUpdate":
            if not isinstance(element_id, str) or not element_id or element_id in ids:
                continue
            ids.add(element_id)
        elements.append(safe)
    if not elements:
        return fallback_presentation(spoken)
    presentation = {
        "kind": "excalidraw",
        "title": (
            value["title"].strip()[:MAX_TITLE_LENGTH]
            if isinstance(value.get("title"), str)
            else "Pi diagram"
        ),
        "elements": elements,
    }
    if len(json.dumps(presentation, separators=(",", ":")).encode()) > MAX_EXCALIDRAW_BYTES:
        return fallback_presentation(spoken)
    return presentation


def parse_presentation_response(raw: str) -> PresentationResponse:
    """Return safe speech and a bounded structured MCP App presentation."""
    candidate = _strip_code_fence(raw)
    try:
        payload = json.loads(candidate, strict=False)
    except (json.JSONDecodeError, TypeError):
        payload = None

    if isinstance(payload, dict):
        spoken_value = payload.get("spoken")
        spoken = spoken_value.strip() if isinstance(spoken_value, str) else ""
    else:
        spoken = raw.strip()
    spoken = (spoken or "Done.")[:MAX_SPOKEN_LENGTH]
    presentation = _normalize_presentation(
        payload.get("presentation") if isinstance(payload, dict) else None,
        spoken,
    )
    resource_uri = (
        EXCALIDRAW_URI
        if presentation.get("kind") == "excalidraw"
        else VOICE_CANVAS_URI
    )
    return PresentationResponse(
        spoken=spoken,
        presentation=presentation,
        resource_uri=resource_uri,
    )
