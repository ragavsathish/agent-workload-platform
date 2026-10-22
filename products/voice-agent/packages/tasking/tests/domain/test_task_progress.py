import json

from voice_agent.tasking.domain.task_progress import narration_from_pi_record


def test_progress_narration_hides_reasoning_and_sensitive_tool_arguments() -> None:
    assert narration_from_pi_record(json.dumps({
        "type": "message_update",
        "assistantMessageEvent": {"type": "thinking_delta", "delta": "private reasoning"},
    }).encode()) is None
    assert narration_from_pi_record(json.dumps({
        "type": "tool_execution_start",
        "toolName": "bash",
        "args": {"command": "cat secret-token"},
    }).encode()) == "The agent is running a workspace command."
    assert narration_from_pi_record(json.dumps({
        "type": "tool_execution_end", "isError": True, "result": "secret output",
    }).encode()) == "A task tool reported an error; the agent is checking what happened."


def test_progress_describes_a_safe_workspace_command() -> None:
    assert narration_from_pi_record(json.dumps({
        "type": "tool_execution_start",
        "toolName": "bash",
        "args": {"command": "git status --short"},
    }).encode()) == "The agent is running: git status --short."
    assert narration_from_pi_record(json.dumps({
        "type": "tool_execution_start",
        "toolName": "read",
        "args": {"path": "/workspace/docs/README.md"},
    }).encode()) == "The agent is reading README.md."
