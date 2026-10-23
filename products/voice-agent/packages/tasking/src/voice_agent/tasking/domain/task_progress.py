"""Bounded narration of observable Pi task actions."""

from __future__ import annotations

import json
import re
from pathlib import PurePath

TOOL_NARRATION = {
    "read": "The agent is reading source files.",
    "write": "The agent is writing a file.",
    "edit": "The agent is editing a file.",
    "bash": "The agent is running a workspace command.",
}

SENSITIVE = re.compile(
    r"(?i)(secret|token|password|passphrase|authorization|bearer|api[_-]?key|"
    r"private[_-]?key|credential|[a-z0-9_-]{32,})"
)


def _safe_detail(value: object, *, max_length: int = 160) -> str | None:
    if not isinstance(value, str) or not value.strip() or "\n" in value or "\r" in value:
        return None
    detail = " ".join(value.split())
    if len(detail) > max_length or SENSITIVE.search(detail):
        return None
    return detail


def _tool_narration(tool: str, args: object) -> str:
    fallback = TOOL_NARRATION.get(tool, "The agent is using a task tool.")
    if not isinstance(args, dict):
        return fallback
    if tool == "bash":
        command = _safe_detail(args.get("command"))
        return f"The agent is running: {command}." if command else fallback
    if tool in {"read", "write", "edit"}:
        path = args.get("path")
        name = _safe_detail(PurePath(path).name) if isinstance(path, str) else None
        if name:
            action = {"read": "reading", "write": "writing", "edit": "editing"}[tool]
            return f"The agent is {action} {name}."
    return fallback


def narration_from_pi_record(line: bytes) -> str | None:
    """Describe task actions without exposing reasoning or sensitive arguments."""
    try:
        event = json.loads(line)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(event, dict):
        return None
    kind = event.get("type")
    if kind == "message_end":
        message = event.get("message")
        if not isinstance(message, dict) or message.get("role") != "assistant":
            return None
        content = message.get("content")
        if not isinstance(content, list):
            return None
        for part in content:
            if not isinstance(part, dict) or part.get("type") != "text":
                continue
            value = part.get("text")
            if not isinstance(value, str):
                continue
            first_line = value.lstrip().splitlines()[0] if value.strip() else ""
            if not first_line.startswith("Progress: "):
                continue
            detail = _safe_detail(first_line.removeprefix("Progress: "), max_length=240)
            if detail:
                return detail
        return None
    if kind == "agent_settled":
        return "The agent has finished and is preparing the result."
    if kind == "tool_execution_start":
        tool = event.get("toolName")
        if not isinstance(tool, str):
            return None
        return _tool_narration(tool, event.get("args"))
    if kind == "tool_execution_end" and event.get("isError") is True:
        return "A task tool reported an error; the agent is checking what happened."
    return None
