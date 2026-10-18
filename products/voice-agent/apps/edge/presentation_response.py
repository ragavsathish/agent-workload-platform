"""Parse the model's combined spoken and structured presentation response."""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

MAX_SPOKEN_LENGTH = 2_000
MAX_TITLE_LENGTH = 160
MAX_LABEL_LENGTH = 240
MAX_NODES = 24
MAX_EDGES = 48
MAX_EXCALIDRAW_ELEMENTS = 80
MAX_EXCALIDRAW_BYTES = 64 * 1024
MAX_MARP_BYTES = 64 * 1024
MAX_JOURNAL_TRANSCRIPT_BYTES = 64 * 1024
MERMAID_URI = "ui://mermaid/main"
EXCALIDRAW_URI = "ui://excalidraw/mcp-app.html"
MARP_URI = "ui://slides/marp.html"
GRAFANA_TRACE_URI = "ui://grafana/trace.html"
PLAYWRIGHT_TRACE_URI = "ui://playwright-trace-viewer/main.html"
JOURNAL_REVIEW_URI = "ui://journal-review/main.html"
EXCALIDRAW_TYPES = {
    "cameraUpdate", "rectangle", "ellipse", "diamond", "text", "arrow", "line"
}
EXCALIDRAW_CAMERA_SIZES = ((400, 300), (600, 450), (800, 600), (1200, 900), (1600, 1200))
JOURNAL_ENTRY_TYPES = {
    "thought", "idea", "question", "decision", "goal", "learning", "unclassified"
}
JOURNAL_OUTCOMES = {"pending", "accepted", "edited", "rejected", "missed", "empty"}


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


def _decode_json(value: str) -> object:
    candidate = _strip_code_fence(value)
    try:
        return json.loads(candidate, strict=False)
    except json.JSONDecodeError as original_error:
        # Pi occasionally appends a closing brace to an otherwise complete
        # response. Repair only that bounded suffix; never guess inside JSON.
        repaired = candidate
        for _ in range(2):
            if not repaired.endswith("}"):
                break
            repaired = repaired[:-1].rstrip()
            try:
                return json.loads(repaired, strict=False)
            except json.JSONDecodeError:
                continue
        raise original_error


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
    if kind == "slides":
        return _normalize_slides(value, spoken)
    if kind == "journal-review":
        return _normalize_journal_review(value, spoken)
    if kind == "grafana-trace":
        trace_id = value.get("traceId")
        datasource_uid = value.get("datasourceUid")
        focus_span_id = value.get("focusSpanId")
        if (
            not isinstance(trace_id, str)
            or re.fullmatch(r"[0-9a-fA-F]{32}", trace_id) is None
            or not isinstance(datasource_uid, str)
            or re.fullmatch(r"[A-Za-z0-9_-]{1,80}", datasource_uid) is None
            or (
                focus_span_id is not None
                and (
                    not isinstance(focus_span_id, str)
                    or re.fullmatch(r"[0-9a-fA-F]{16}", focus_span_id) is None
                )
            )
        ):
            return fallback_presentation(spoken)
        title = value.get("title")
        presentation: dict[str, object] = {
            "kind": "grafana-trace",
            "title": title.strip()[:MAX_TITLE_LENGTH]
            if isinstance(title, str) and title.strip()
            else "Grafana trace",
            "traceId": trace_id.lower(),
            "datasourceUid": datasource_uid,
        }
        if focus_span_id is not None:
            presentation["focusSpanId"] = focus_span_id.lower()
        return presentation
    if kind == "playwright-trace-viewer":
        trace_id = value.get("traceId")
        viewer_url = value.get("viewerUrl")
        preview_url = value.get("previewUrl")
        if (
            not isinstance(trace_id, str)
            or re.fullmatch(r"[0-9a-f]{32}", trace_id) is None
            or not isinstance(viewer_url, str)
        ):
            return fallback_presentation(spoken)
        viewer = urlparse(viewer_url)
        trace_values = parse_qs(viewer.query).get("trace", [])
        if (
            viewer.scheme not in {"http", "https"}
            or not viewer.netloc
            or viewer.path != "/trace-viewer/index.html"
            or len(trace_values) != 1
        ):
            return fallback_presentation(spoken)
        trace = urlparse(trace_values[0])
        if (
            (trace.scheme, trace.netloc) != (viewer.scheme, viewer.netloc)
            or trace.path != f"/api/playwright-traces/{trace_id}/trace.zip"
        ):
            return fallback_presentation(spoken)
        preview = urlparse(preview_url) if isinstance(preview_url, str) else None
        if preview is not None and (
            (preview.scheme, preview.netloc) != (viewer.scheme, viewer.netloc)
            or preview.path != f"/api/playwright-traces/{trace_id}/preview"
            or preview.query
        ):
            return fallback_presentation(spoken)
        narrated_video_url = value.get("narratedVideoUrl")
        narrated_video = (
            urlparse(narrated_video_url)
            if isinstance(narrated_video_url, str)
            else None
        )
        if narrated_video is not None and (
            (narrated_video.scheme, narrated_video.netloc) != (viewer.scheme, viewer.netloc)
            or re.fullmatch(r"/api/trace-explainers/[0-9a-f]{32}/video", narrated_video.path) is None
            or narrated_video.query
        ):
            return fallback_presentation(spoken)
        actions: list[dict[str, object]] = []
        for raw_action in value.get("actions", [])[:12] if isinstance(value.get("actions"), list) else []:
            if not isinstance(raw_action, dict):
                continue
            label = raw_action.get("label")
            duration_ms = raw_action.get("durationMs")
            status = raw_action.get("status")
            if not isinstance(label, str) or not label.strip():
                continue
            actions.append({
                "label": label.strip()[:240],
                "durationMs": max(0, min(int(duration_ms), 3_600_000))
                if isinstance(duration_ms, (int, float)) else 0,
                "status": status if status in {"completed", "error"} else "completed",
            })
        result: dict[str, object] = {
            "kind": "playwright-trace-viewer",
            "title": title.strip()[:MAX_TITLE_LENGTH]
            if isinstance(title, str) and title.strip()
            else "Playwright trace",
            "summary": str(value.get("summary", ""))[:MAX_LABEL_LENGTH],
            "traceId": trace_id,
            "project": str(value.get("project", "unknown"))[:80],
            "run": str(value.get("run", "unknown"))[:120],
            "modifiedAt": str(value.get("modifiedAt", ""))[:80],
            "viewerUrl": viewer_url[:2_000],
            "durationMs": max(0, min(int(value.get("durationMs", 0)), 3_600_000))
            if isinstance(value.get("durationMs"), (int, float)) else 0,
            "actionCount": max(0, min(int(value.get("actionCount", 0)), 100_000))
            if isinstance(value.get("actionCount"), (int, float)) else len(actions),
            "requestCount": max(0, min(int(value.get("requestCount", 0)), 1_000_000))
            if isinstance(value.get("requestCount"), (int, float)) else 0,
            "errorCount": max(0, min(int(value.get("errorCount", 0)), 100_000))
            if isinstance(value.get("errorCount"), (int, float)) else 0,
            "actions": actions,
        }
        if preview is not None:
            result["previewUrl"] = preview_url[:2_000]
        if narrated_video is not None:
            result["narratedVideoUrl"] = narrated_video_url[:2_000]
            result["narratedDurationSeconds"] = max(
                0,
                min(int(value.get("narratedDurationSeconds", 0)), 3_600),
            ) if isinstance(value.get("narratedDurationSeconds"), (int, float)) else 0
            result["narratedSceneCount"] = max(
                0,
                min(int(value.get("narratedSceneCount", 0)), 50),
            ) if isinstance(value.get("narratedSceneCount"), (int, float)) else 0
        return result
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
            bounded_item
            for item in value[:128]
            if (bounded_item := _bounded_json_value(item, depth + 1)) is not None
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


def _finite_number(value: object, default: int | float = 0) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    return value if math.isfinite(value) else default


def _repair_excalidraw_camera(
    camera: dict[str, object], elements: list[dict[str, object]]
) -> dict[str, object]:
    x = _finite_number(camera.get("x"))
    y = _finite_number(camera.get("y"))
    width = _finite_number(camera.get("width"))
    height = _finite_number(camera.get("height"))
    if width > 0 and height > 0 and abs((width / height) - (4 / 3)) < 0.01:
        return {"type": "cameraUpdate", "x": x, "y": y, "width": width, "height": height}

    required_width = 400.0
    required_height = 300.0
    for element in elements:
        if element.get("type") == "cameraUpdate":
            continue
        element_x = _finite_number(element.get("x"), x)
        element_y = _finite_number(element.get("y"), y)
        element_width = max(0, _finite_number(element.get("width")))
        element_height = max(0, _finite_number(element.get("height")))
        required_width = max(required_width, element_x + element_width - x + 40)
        required_height = max(required_height, element_y + element_height - y + 40)

    repaired_width, repaired_height = EXCALIDRAW_CAMERA_SIZES[-1]
    for candidate_width, candidate_height in EXCALIDRAW_CAMERA_SIZES:
        if candidate_width >= required_width and candidate_height >= required_height:
            repaired_width, repaired_height = candidate_width, candidate_height
            break
    return {
        "type": "cameraUpdate",
        "x": x,
        "y": y,
        "width": repaired_width,
        "height": repaired_height,
    }


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
            label = safe.get("label")
            if isinstance(label, str):
                label = " ".join(label.split())[:MAX_LABEL_LENGTH]
                if label:
                    safe["label"] = {"text": label}
                else:
                    safe.pop("label", None)
        elements.append(safe)
    if not elements:
        return fallback_presentation(spoken)
    camera_indexes = [
        index for index, element in enumerate(elements)
        if element.get("type") == "cameraUpdate"
    ]
    if camera_indexes:
        for index in camera_indexes:
            elements[index] = _repair_excalidraw_camera(elements[index], elements)
    else:
        elements.insert(0, _repair_excalidraw_camera({}, elements))
    title = value.get("title")
    presentation = {
        "kind": "excalidraw",
        "title": (
            title.strip()[:MAX_TITLE_LENGTH]
            if isinstance(title, str)
            else "Pi diagram"
        ),
        "elements": elements,
    }
    if len(json.dumps(presentation, separators=(",", ":")).encode()) > MAX_EXCALIDRAW_BYTES:
        return fallback_presentation(spoken)
    return presentation


def _normalize_slides(value: dict[object, object], spoken: str) -> dict[str, object]:
    markdown = value.get("markdown")
    if not isinstance(markdown, str):
        return fallback_presentation(spoken)
    markdown = markdown.strip()
    if not markdown or len(markdown.encode()) > MAX_MARP_BYTES:
        return fallback_presentation(spoken)
    title = value.get("title")
    return {
        "kind": "slides",
        "title": (
            title.strip()[:MAX_TITLE_LENGTH]
            if isinstance(title, str) and title.strip()
            else "Pi slides"
        ),
        "markdown": markdown,
    }


def _normalize_journal_review(
    value: dict[object, object], spoken: str
) -> dict[str, object]:
    transcript = value.get("transcript")
    review_id = value.get("reviewId")
    suggestion = value.get("suggestion")
    if (
        not isinstance(transcript, str)
        or not transcript.strip()
        or len(transcript.encode()) > MAX_JOURNAL_TRANSCRIPT_BYTES
        or not isinstance(review_id, str)
        or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9:._-]{0,199}", review_id) is None
        or not isinstance(suggestion, dict)
    ):
        return fallback_presentation(spoken)

    suggestion_id = suggestion.get("id")
    kind = suggestion.get("type")
    statement = suggestion.get("statement")
    confidence = suggestion.get("confidence")
    if (
        not isinstance(suggestion_id, str)
        or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9:._-]{0,199}", suggestion_id) is None
        or kind not in JOURNAL_ENTRY_TYPES
        or not isinstance(statement, str)
        or not statement.strip()
        or len(statement) > 2_000
        or isinstance(confidence, bool)
        or not isinstance(confidence, (int, float))
        or not math.isfinite(confidence)
        or confidence < 0
        or confidence > 1
    ):
        return fallback_presentation(spoken)

    topics_value = suggestion.get("topics", [])
    if not isinstance(topics_value, list):
        return fallback_presentation(spoken)
    topics = [
        topic.strip()[:100]
        for topic in topics_value[:8]
        if isinstance(topic, str) and topic.strip()
    ]
    normalized_suggestion: dict[str, object] = {
        "id": suggestion_id,
        "type": kind,
        "statement": statement.strip(),
        "topics": topics,
        "confidence": confidence,
    }
    evidence = suggestion.get("evidence")
    if evidence is not None:
        if not isinstance(evidence, dict):
            return fallback_presentation(spoken)
        quote = evidence.get("quote")
        start = evidence.get("start")
        end = evidence.get("end")
        if (
            not isinstance(quote, str)
            or not quote
            or len(quote) > 4_000
            or isinstance(start, bool)
            or not isinstance(start, int)
            or isinstance(end, bool)
            or not isinstance(end, int)
            or start < 0
            or end <= start
            or transcript[start:end] != quote
        ):
            return fallback_presentation(spoken)
        normalized_suggestion["evidence"] = {"quote": quote, "start": start, "end": end}

    progress_value = value.get("progress", {})
    if not isinstance(progress_value, dict):
        progress_value = {}

    def progress_number(name: str, default: int) -> int:
        candidate = progress_value.get(name)
        if isinstance(candidate, bool) or not isinstance(candidate, int):
            return default
        return max(0, min(10_000, candidate))

    outcome = value.get("outcome", "pending")
    if outcome not in JOURNAL_OUTCOMES:
        outcome = "pending"
    title = value.get("title")
    source = value.get("source")
    return {
        "kind": "journal-review",
        "reviewId": review_id,
        "title": title.strip()[:MAX_TITLE_LENGTH]
        if isinstance(title, str) and title.strip()
        else "Review journal extraction",
        "source": source.strip()[:MAX_LABEL_LENGTH]
        if isinstance(source, str) and source.strip()
        else "Voice session",
        "transcript": transcript,
        "suggestion": normalized_suggestion,
        "progress": {
            "current": max(1, progress_number("current", 1)),
            "total": max(1, progress_number("total", 1)),
            "reviewed": progress_number("reviewed", 0),
        },
        "outcome": outcome,
    }


def parse_presentation_response(raw: str) -> PresentationResponse:
    """Return safe speech and a bounded structured MCP App presentation."""
    candidate = _strip_code_fence(raw)
    payload: object = candidate
    # Pi's OpenAI-compatible transport can JSON-encode an already structured
    # assistant response more than once. Keep this deliberately shallow so a
    # valid response is recovered without recursively interpreting arbitrary
    # model text.
    for _ in range(4):
        if isinstance(payload, dict):
            nested = payload.get("spoken")
            if not isinstance(nested, str):
                break
            try:
                nested_payload = _decode_json(nested)
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
            payload = _decode_json(payload)
        except (json.JSONDecodeError, TypeError):
            payload = None
            break

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
    kind = presentation.get("kind")
    if kind == "excalidraw":
        resource_uri = EXCALIDRAW_URI
    elif kind == "slides":
        resource_uri = MARP_URI
    elif kind == "grafana-trace":
        resource_uri = GRAFANA_TRACE_URI
    elif kind == "playwright-trace-viewer":
        resource_uri = PLAYWRIGHT_TRACE_URI
    elif kind == "journal-review":
        resource_uri = JOURNAL_REVIEW_URI
    else:
        resource_uri = MERMAID_URI
    return PresentationResponse(
        spoken=spoken,
        presentation=presentation,
        resource_uri=resource_uri,
    )
