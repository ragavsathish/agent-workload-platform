"""Owner-only Telegram console for durable Agent Tasks.

This adapter deliberately has no LLM or Pi session. The browser voice agent is
the orchestrator; Telegram can review and operate only the durable task API.
"""

from __future__ import annotations

import asyncio
import html
import json
import os
import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

from voice_agent.shared.telemetry import configure_telemetry

MAX_TELEGRAM_TEXT = 3900
TASK_ID = re.compile(r"[0-9a-fA-F-]{36}")
telemetry = configure_telemetry("task-telegram")


def _secret(name: str) -> str:
    path = os.getenv(f"{name}_FILE", "").strip()
    value = Path(path).read_text(encoding="utf-8").strip() if path else os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def _integer_set(name: str) -> frozenset[int]:
    try:
        values = frozenset(
            int(value.strip()) for value in os.getenv(name, "").split(",") if value.strip()
        )
    except ValueError as exc:
        raise RuntimeError(f"{name} must contain comma-separated integers") from exc
    if not values:
        raise RuntimeError(f"{name} is required")
    return values


@dataclass(frozen=True)
class Settings:
    bot_token: str
    gateway_token: str
    gateway_url: str
    identity: str
    chat_id: int
    allowed_user_ids: frozenset[int]
    state_path: Path

    @classmethod
    def from_env(cls) -> Settings:
        identities = [
            value.strip().lower()
            for value in os.getenv("ORCHESTRATOR_ALLOWED_USERS", "").split(",")
            if value.strip()
        ]
        if len(identities) != 1:
            raise RuntimeError("Telegram tasks require exactly one orchestrator identity")
        return cls(
            bot_token=_secret("TELEGRAM_BOT_TOKEN"),
            gateway_token=_secret("TELEGRAM_GATEWAY_TOKEN"),
            gateway_url=os.getenv("AGENT_GATEWAY_BASE_URL", "http://agent-gateway:9444/v1").rstrip(
                "/"
            ),
            identity=identities[0],
            chat_id=int(os.environ["TELEGRAM_CHAT_ID"]),
            allowed_user_ids=_integer_set("TELEGRAM_ALLOWED_USER_IDS"),
            state_path=Path(os.getenv("TELEGRAM_STATE_PATH", "/var/lib/task-telegram/state.json")),
        )


@dataclass
class PersistentState:
    update_offset: int = 0
    initialized: bool = False
    task_states: dict[str, str] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> PersistentState:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            return cls(
                update_offset=max(0, int(payload.get("update_offset", 0))),
                initialized=bool(payload.get("initialized", False)),
                task_states={
                    str(key): str(value) for key, value in payload.get("task_states", {}).items()
                },
            )
        except (FileNotFoundError, json.JSONDecodeError, TypeError, ValueError):
            return cls()

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(
                {
                    "update_offset": self.update_offset,
                    "initialized": self.initialized,
                    "task_states": self.task_states,
                },
                sort_keys=True,
            ),
            encoding="utf-8",
        )
        os.chmod(temporary, 0o600)
        temporary.replace(path)


def parse_command(text: str) -> tuple[str, list[str]]:
    parts = text.strip().split()
    if not parts or not parts[0].startswith("/"):
        return "help", []
    command = parts[0][1:].split("@", 1)[0].lower()
    return command, parts[1:]


def validated_task_id(value: str) -> str:
    if not TASK_ID.fullmatch(value):
        raise ValueError("task ID must be a UUID")
    return str(uuid.UUID(value))


def task_state(task: dict[str, Any]) -> str:
    result = task.get("result")
    result_state = result.get("state") if isinstance(result, dict) else None
    return str(result_state or task.get("status") or "unknown")


def task_summary(task: dict[str, Any], *, include_instruction: bool = True) -> str:
    task_id = html.escape(str(task.get("id", "unknown")))
    state = html.escape(task_state(task))
    workspace = html.escape(str(task.get("workspace", "unknown")))
    lines = [
        f"<b>Task {task_id}</b>",
        f"State: <code>{state}</code>",
        f"Workspace: <code>{workspace}</code>",
    ]
    if include_instruction:
        instruction = html.escape(str(task.get("instruction", ""))[:2000])
        lines.extend(["", instruction])
    result = task.get("result")
    execution = result.get("result") if isinstance(result, dict) else None
    response = execution.get("response") if isinstance(execution, dict) else None
    text = response.get("text") if isinstance(response, dict) else None
    if isinstance(text, str) and text.strip():
        lines.extend(["", "<b>Result</b>", html.escape(text.strip()[:3000])])
    artifacts = execution.get("artifacts") if isinstance(execution, dict) else None
    if isinstance(artifacts, list) and artifacts:
        lines.extend(
            [
                "",
                "Artifacts: "
                + ", ".join(f"<code>{html.escape(str(item))}</code>" for item in artifacts),
            ]
        )
    return "\n".join(lines)[:MAX_TELEGRAM_TEXT]


class GatewayClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient):
        self.settings = settings
        self.client = client

    async def request(self, method: str, path: str, body: dict[str, str] | None = None) -> Any:
        response = await self.client.request(
            method,
            f"{self.settings.gateway_url}{path}",
            headers={"Authorization": f"Bearer {self.settings.gateway_token}"},
            json=body,
        )
        if response.is_error:
            try:
                detail = response.json().get("detail", "request failed")
            except (ValueError, AttributeError):
                detail = "request failed"
            raise RuntimeError(str(detail))
        return response.json()

    async def list_tasks(self) -> list[dict[str, Any]]:
        payload = await self.request(
            "GET", f"/tasks?identity={quote(self.settings.identity)}&limit=20"
        )
        return payload if isinstance(payload, list) else []

    async def get_task(self, task_id: str) -> dict[str, Any]:
        payload = await self.request(
            "GET", f"/tasks/{task_id}?identity={quote(self.settings.identity)}"
        )
        if not isinstance(payload, dict):
            raise RuntimeError("gateway returned an invalid task")
        return payload

    async def create_task(self, workspace: str, instruction: str) -> dict[str, Any]:
        payload = await self.request(
            "POST",
            "/tasks",
            {
                "identity": self.settings.identity,
                "workspace": workspace,
                "instruction": instruction,
            },
        )
        if not isinstance(payload, dict):
            raise RuntimeError("gateway returned an invalid task")
        return payload

    async def operate(self, task_id: str, operation: str) -> dict[str, Any]:
        payload = await self.request(
            "POST", f"/tasks/{task_id}/{operation}", {"identity": self.settings.identity}
        )
        if not isinstance(payload, dict):
            raise RuntimeError("gateway returned an invalid task")
        return payload

    async def artifact(self, task_id: str, artifact: str) -> tuple[str, bytes]:
        response = await self.client.get(
            f"{self.settings.gateway_url}/tasks/{task_id}/artifacts/{artifact}",
            params={"identity": self.settings.identity},
            headers={"Authorization": f"Bearer {self.settings.gateway_token}"},
        )
        if response.is_error:
            raise RuntimeError("artifact is unavailable")
        disposition = response.headers.get("content-disposition", "")
        match = re.search(r'filename="([a-zA-Z0-9._-]+)"', disposition)
        return (match.group(1) if match else f"{artifact}.txt", response.content)


class TelegramClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient):
        self.settings = settings
        self.client = client
        self.base_url = f"https://api.telegram.org/bot{settings.bot_token}"

    async def call(
        self,
        method: str,
        *,
        data: dict[str, Any] | None = None,
        files: dict[str, Any] | None = None,
    ) -> Any:
        response = await self.client.post(f"{self.base_url}/{method}", data=data, files=files)
        response.raise_for_status()
        payload = response.json()
        if not payload.get("ok"):
            raise RuntimeError("Telegram rejected the request")
        return payload.get("result")

    async def updates(self, offset: int) -> list[dict[str, Any]]:
        result = await self.call(
            "getUpdates",
            data={"offset": offset, "timeout": 20, "allowed_updates": json.dumps(["message"])},
        )
        return result if isinstance(result, list) else []

    async def send_text(self, text: str) -> None:
        message = text[:MAX_TELEGRAM_TEXT]
        try:
            await self.call(
                "sendMessage",
                data={"chat_id": self.settings.chat_id, "text": message, "parse_mode": "HTML"},
            )
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 400:
                raise
            # A task result can contain unexpected markup. Keep delivery reliable
            # by retrying without Telegram's HTML parser.
            await self.call(
                "sendMessage",
                data={
                    "chat_id": self.settings.chat_id,
                    "text": re.sub(r"<[^>]+>", "", html.unescape(message)),
                },
            )

    async def send_document(self, filename: str, payload: bytes) -> None:
        await self.call(
            "sendDocument",
            data={"chat_id": self.settings.chat_id},
            files={"document": (filename, payload, "application/octet-stream")},
        )


HELP = """<b>Task console</b>
/create &lt;workspace&gt; &lt;instruction&gt; — create a pending proposal
/tasks — recent tasks
/task &lt;id&gt; — instruction, status, and result
/approve &lt;id&gt; — approve a pending proposal
/cancel &lt;id&gt; — cancel a task
/artifact &lt;id&gt; &lt;patch|status|execution&gt; — download one artifact

Creation does not execute work until /approve is sent."""


class TaskTelegramService:
    def __init__(self, settings: Settings, telegram: TelegramClient, gateway: GatewayClient):
        self.settings = settings
        self.telegram = telegram
        self.gateway = gateway
        self.state = PersistentState.load(settings.state_path)

    def authorized(self, message: dict[str, Any]) -> bool:
        sender = message.get("from")
        chat = message.get("chat")
        return (
            isinstance(sender, dict)
            and sender.get("id") in self.settings.allowed_user_ids
            and isinstance(chat, dict)
            and chat.get("id") == self.settings.chat_id
        )

    async def handle_message(self, message: dict[str, Any]) -> None:
        if not self.authorized(message):
            telemetry.record("telegram.message.rejected", outcome="denied")
            return
        command, arguments = parse_command(str(message.get("text", "")))
        try:
            with telemetry.observe(
                f"telegram.command.{command if command in {'create', 'tasks', 'task', 'approve', 'cancel', 'artifact', 'help'} else 'unknown'}"
            ):
                if command in {"start", "help"}:
                    await self.telegram.send_text(HELP)
                elif command == "create":
                    if len(arguments) < 2:
                        raise ValueError("Usage: /create &lt;workspace&gt; &lt;instruction&gt;")
                    task = await self.gateway.create_task(arguments[0], " ".join(arguments[1:]))
                    await self.telegram.send_text(task_summary(task))
                elif command == "tasks":
                    tasks = await self.gateway.list_tasks()
                    text = (
                        "<b>Recent tasks</b>\n\n"
                        + "\n\n".join(
                            task_summary(task, include_instruction=False) for task in tasks[:10]
                        )
                        if tasks
                        else "No tasks yet."
                    )
                    await self.telegram.send_text(text)
                elif command in {"task", "approve", "cancel"}:
                    if len(arguments) != 1:
                        raise ValueError(f"Usage: /{command} &lt;task-id&gt;")
                    task_id = validated_task_id(arguments[0])
                    task = await (
                        self.gateway.get_task(task_id)
                        if command == "task"
                        else self.gateway.operate(task_id, command)
                    )
                    await self.telegram.send_text(task_summary(task))
                elif command == "artifact":
                    if len(arguments) != 2 or arguments[1] not in {"patch", "status", "execution"}:
                        raise ValueError(
                            "Usage: /artifact &lt;task-id&gt; &lt;patch|status|execution&gt;"
                        )
                    task_id = validated_task_id(arguments[0])
                    filename, payload = await self.gateway.artifact(task_id, arguments[1])
                    await self.telegram.send_document(filename, payload)
                else:
                    await self.telegram.send_text(HELP)
        except (RuntimeError, ValueError) as exc:
            await self.telegram.send_text(f"<b>Task request failed</b>\n{html.escape(str(exc))}")

    async def sync_notifications(self) -> None:
        tasks = await self.gateway.list_tasks()
        current = {str(task.get("id")): task_state(task) for task in tasks if task.get("id")}
        if self.state.initialized:
            for task in reversed(tasks):
                task_id = str(task.get("id", ""))
                previous = self.state.task_states.get(task_id)
                state = current.get(task_id)
                if task_id and state and previous != state:
                    await self.telegram.send_text(task_summary(task))
        self.state.task_states = current
        self.state.initialized = True

    async def run(self) -> None:
        while True:
            try:
                for update in await self.telegram.updates(self.state.update_offset):
                    update_id = int(update.get("update_id", -1))
                    self.state.update_offset = max(self.state.update_offset, update_id + 1)
                    message = update.get("message")
                    if isinstance(message, dict):
                        await self.handle_message(message)
                await self.sync_notifications()
                self.state.save(self.settings.state_path)
            except (httpx.HTTPError, RuntimeError):
                telemetry.record("telegram.poll", outcome="error")
                await asyncio.sleep(2)


async def async_main() -> None:
    settings = Settings.from_env()
    timeout = httpx.Timeout(connect=10, read=30, write=30, pool=10)
    async with httpx.AsyncClient(timeout=timeout) as client:
        service = TaskTelegramService(
            settings,
            TelegramClient(settings, client),
            GatewayClient(settings, client),
        )
        await service.run()


def main() -> None:
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
