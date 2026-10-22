"""Bounded, content-free narration of observable Pi task events."""

from __future__ import annotations

import json

TOOL_NARRATION = {
    "read": "The agent is reading source files.",
    "write": "The agent is writing a file.",
    "edit": "The agent is editing a file.",
    "bash": "The agent is running a workspace command.",
}


def narration_from_pi_record(line: bytes) -> str | None:
    """Use only event kinds and tool names; never expose model reasoning or arguments."""
    try:
        event = json.loads(line)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(event, dict):
        return None
    kind = event.get("type")
    if kind == "turn_start":
        return "The agent has started working."
    if kind == "agent_settled":
        return "The agent has finished and is preparing the result."
    if kind == "tool_execution_start":
        tool = event.get("toolName")
        if not isinstance(tool, str):
            return None
        return TOOL_NARRATION.get(tool, "The agent is using a task tool.")
    if kind == "tool_execution_end" and event.get("isError") is True:
        return "A task tool reported an error; the agent is checking what happened."
    return None
