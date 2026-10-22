import json

from voice_agent.tasking.domain.task_progress import narration_from_pi_record


def test_progress_narration_never_exposes_reasoning_or_tool_arguments() -> None:
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
