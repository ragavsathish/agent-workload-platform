import asyncio
from pathlib import Path

import pytest

from voice_agent.tasking.presentation.telegram import (
    PersistentState,
    Settings,
    TaskTelegramService,
    parse_command,
    task_state,
    task_summary,
    validated_task_id,
)


def test_commands_do_not_treat_plain_chat_as_task_creation() -> None:
    assert parse_command("please run tests") == ("help", [])
    assert parse_command("/create@owner_bot project run all tests") == (
        "create",
        ["project", "run", "all", "tests"],
    )


def test_task_ids_must_be_canonical_uuids() -> None:
    value = "86ec9e7e-7c27-44bb-bd3a-a61030519484"
    assert validated_task_id(value) == value
    with pytest.raises(ValueError, match="UUID"):
        validated_task_id("../../other-task")


def test_task_rendering_escapes_telegram_html() -> None:
    task = {
        "id": "86ec9e7e-7c27-44bb-bd3a-a61030519484",
        "status": "approved",
        "workspace": "project",
        "instruction": "Review <script> & report",
        "result": {"state": "running"},
    }
    assert task_state(task) == "running"
    rendered = task_summary(task)
    assert "&lt;script&gt; &amp; report" in rendered
    assert "<script>" not in rendered


def test_poll_offset_and_task_states_survive_restart(tmp_path: Path) -> None:
    path = tmp_path / "state.json"
    state = PersistentState(
        update_offset=42,
        initialized=True,
        task_states={"task-1": "completed"},
    )
    state.save(path)
    assert PersistentState.load(path) == state
    assert path.stat().st_mode & 0o777 == 0o600


def test_create_and_approve_are_separate_explicit_commands(tmp_path: Path) -> None:
    class Telegram:
        def __init__(self) -> None:
            self.messages: list[str] = []

        async def send_text(self, text: str) -> None:
            self.messages.append(text)

    class Gateway:
        def __init__(self) -> None:
            self.created: list[tuple[str, str]] = []
            self.operations: list[tuple[str, str]] = []

        async def create_task(self, workspace: str, instruction: str):
            self.created.append((workspace, instruction))
            return {"id": TASK_ID, "status": "pending", "workspace": workspace}

        async def operate(self, task_id: str, operation: str):
            self.operations.append((task_id, operation))
            return {"id": task_id, "status": "approved", "workspace": "project"}

    settings = Settings(
        bot_token="bot-token",
        gateway_token="g" * 32,
        gateway_url="http://gateway/v1",
        identity="owner@example.com",
        chat_id=100,
        allowed_user_ids=frozenset({200}),
        state_path=tmp_path / "state.json",
    )
    telegram = Telegram()
    gateway = Gateway()
    service = TaskTelegramService(
        settings,
        telegram,  # type: ignore[arg-type]
        gateway,  # type: ignore[arg-type]
    )
    message = {"chat": {"id": 100}, "from": {"id": 200}}

    asyncio.run(
        service.handle_message(
            {**message, "text": "/create project explain the task architecture"}
        )
    )
    assert gateway.created == [("project", "explain the task architecture")]
    assert gateway.operations == []

    asyncio.run(service.handle_message({**message, "text": f"/approve {TASK_ID}"}))
    assert gateway.operations == [(TASK_ID, "approve")]


TASK_ID = "86ec9e7e-7c27-44bb-bd3a-a61030519484"
