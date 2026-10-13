"""Parse the model's combined spoken and visual response."""

from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass

MAX_DIAGRAM_LENGTH = 24_000
MAX_SPOKEN_LENGTH = 2_000

_MERMAID_PREFIX = re.compile(
    r"^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|"
    r"erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|xychart-beta)\b"
)


@dataclass(frozen=True)
class VisualResponse:
    spoken: str
    mermaid: str


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


def fallback_mermaid(spoken: str) -> str:
    """Build a valid, bounded diagram without interpreting model syntax."""
    label = " ".join(spoken.split()) or "Ready"
    label = html.escape(label[:240], quote=True)
    return f'flowchart TD\n  result["{label}"]'


def parse_visual_response(raw: str) -> VisualResponse:
    """Return safe speech and Mermaid, degrading to a summary diagram."""
    candidate = _strip_code_fence(raw)
    try:
        payload = json.loads(candidate)
    except (json.JSONDecodeError, TypeError):
        payload = None

    if isinstance(payload, dict):
        spoken_value = payload.get("spoken")
        mermaid_value = payload.get("mermaid")
        spoken = spoken_value.strip() if isinstance(spoken_value, str) else ""
        diagram = _strip_code_fence(mermaid_value) if isinstance(mermaid_value, str) else ""
    else:
        spoken = raw.strip()
        diagram = ""

    if not spoken:
        spoken = "Done."
    spoken = spoken[:MAX_SPOKEN_LENGTH]

    if (
        not diagram
        or len(diagram) > MAX_DIAGRAM_LENGTH
        or not _MERMAID_PREFIX.match(diagram)
    ):
        diagram = fallback_mermaid(spoken)

    return VisualResponse(spoken=spoken, mermaid=diagram)
