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


def test_progress_omits_generic_task_start() -> None:
    assert narration_from_pi_record(b'{"type":"turn_start"}') is None


def test_progress_accepts_only_explicit_public_assistant_commentary() -> None:
    def record(text: str) -> bytes:
        return json.dumps({
            "type": "message_end",
            "message": {"role": "assistant", "content": [{"type": "text", "text": text}]},
        }).encode()

    assert narration_from_pi_record(record(
        "Progress: I am checking the API contract before changing the client."
    )) == "I am checking the API contract before changing the client."
    assert narration_from_pi_record(record(
        "\n\nProgress: I am reading the README to identify its owner.\n\n"
    )) == "I am reading the README to identify its owner."
    assert narration_from_pi_record(record(
        "\nProgress: I have found the owner and will summarize it.\n\n{\"spoken\":\"Final\"}"
    )) == "I have found the owner and will summarize it."
    assert narration_from_pi_record(record("My private scratch work")) is None
    assert narration_from_pi_record(record("Progress: read secret-token")) is None
    assert narration_from_pi_record(record('{"spoken":"Final result"}')) is None
