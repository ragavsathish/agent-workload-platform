from pathlib import Path

import pytest

from orchestrator.config import Settings
from orchestrator.worker import build_pi_command


def settings(tmp_path: Path, *, sandboxed: bool) -> Settings:
    return Settings(
        database_url="postgresql://test",
        approval_secret="s" * 32,
        allowed_users=(),
        workspace_roots=(tmp_path,),
        allow_local_dev=True,
        approval_ttl_seconds=300,
        queue="agents",
        pi_binary="/opt/homebrew/bin/pi",
        pi_model="openai-codex/gpt-5",
        pi_thinking="medium",
        pi_session_dir=tmp_path / "sessions",
        gondolin_extension=(tmp_path / "gondolin.ts") if sandboxed else None,
        allow_unsandboxed=False,
        task_timeout_seconds=60,
        max_output_bytes=1024,
    )


def test_command_uses_only_explicit_gondolin_tools(tmp_path: Path) -> None:
    command = build_pi_command(
        settings(tmp_path, sandboxed=True), task_id="abc", instruction="work"
    )
    assert "--no-builtin-tools" in command
    assert "--extension" in command
    assert command[-2:] == ["--", "work"]


def test_command_refuses_unsandboxed_execution_by_default(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="PI_GONDOLIN_EXTENSION"):
        build_pi_command(settings(tmp_path, sandboxed=False), task_id="abc", instruction="work")
