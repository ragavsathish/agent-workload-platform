"""Direct Voice Agent task operations backed by the Pi Durable owner."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime
from typing import Any

from voice_agent.tasking.domain.session_albums import album_by_key, album_for_session
from voice_agent.tasking.domain.task_plan import plan_hash
from voice_agent.tasking.domain.workspaces import (
    SCRATCH_WORKSPACE,
    is_scratch_workspace,
    resolve_workspace,
    validate_workspace_boundary,
)
from voice_agent.tasking.infrastructure.artifacts import TASK_ARTIFACTS, ArtifactStore
from voice_agent.tasking.infrastructure.config import Settings
from voice_agent.tasking.infrastructure.pi_durable_owner import PiDurableOwner


class TaskError(ValueError):
    """A safe task lifecycle error."""


def bounded_trace_context(carrier: dict[str, str] | None) -> dict[str, str]:
    """Keep only bounded W3C context required to continue a durable trace."""
    if carrier is None:
        return {}
    return {
        key: value
        for key in ("traceparent", "tracestate")
        if isinstance((value := carrier.get(key)), str) and 0 < len(value) <= 512
    }


class TaskService:
    def __init__(self, settings: Settings):
        settings.require_api()
        self.settings = settings
        self.owner = PiDurableOwner(
            settings.pi_durable_owner_url, settings.pi_durable_owner_token_file
        )
        self.artifacts = (
            ArtifactStore(
                endpoint_url=settings.artifact_endpoint_url,
                bucket=settings.artifact_bucket,
                access_key=settings.artifact_access_key,
                secret_key=settings.artifact_secret_key,
            )
            if settings.artifact_workspaces
            else None
        )

    def _plan(self, instruction: str, workspace: str) -> dict[str, str]:
        cleaned = instruction.strip()
        if not cleaned:
            raise TaskError("instruction cannot be empty")
        if is_scratch_workspace(workspace):
            return {"instruction": cleaned, "workspace": SCRATCH_WORKSPACE}
        if self.artifacts:
            resolved = self.artifacts.resolve_workspace(
                workspace, self.settings.allowed_workspaces
            )
        else:
            try:
                resolved = (
                    validate_workspace_boundary(workspace, self.settings.workspace_roots)
                    if self.settings.defer_workspace_validation
                    else resolve_workspace(workspace, self.settings.workspace_roots)
                )
            except ValueError as exc:
                raise TaskError(str(exc)) from exc
        return {"instruction": cleaned, "workspace": str(resolved)}

    def submit(
        self,
        *,
        identity: str,
        instruction: str,
        workspace: str,
        trace_context: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """Admit work as one Pi Durable task and return its public task view."""
        plan = self._plan(instruction, workspace)
        task_id = str(uuid.uuid4())
        album = album_for_session(task_id)
        session_name = f"{album.title} · {task_id[:8]}"
        self.owner.submit(
            "agent-run",
            {
                "native_cli": True,
                "identity": identity,
                "instruction": plan["instruction"],
                "workspace": plan["workspace"],
                "session_album_key": album.key,
                "session_name": session_name,
                "trace_context": bounded_trace_context(trace_context),
            },
            task_id,
        )
        native = self.owner.describe(task_id)
        if native is None:
            raise RuntimeError("Pi Durable accepted a task but could not describe it")
        return self._native_view(native)

    def enqueue_digital_twin(
        self,
        *,
        identity: str,
        session_id: str,
        message_id: str,
        transcript: str,
        captured_at: str,
    ) -> dict[str, Any]:
        """Fan one owner turn out to independently retryable ingestion tasks."""
        text = transcript.strip()
        if not text:
            raise TaskError("transcript cannot be empty")
        if len(text) > 20_000:
            raise TaskError("transcript is too large")
        if not session_id.strip() or not message_id.strip():
            raise TaskError("session_id and message_id are required")
        source_key = f"{session_id.strip()}:{message_id.strip()}"
        tasks: dict[str, dict[str, str]] = {}
        for mode in ("journal", "classify"):
            idempotency_key = f"digital-twin:{mode}:{source_key}"
            native_request_id = str(uuid.uuid5(uuid.NAMESPACE_URL, idempotency_key))
            task_id = self.owner.submit(
                f"digital-twin-{mode}",
                {
                    "mode": mode,
                    "identity": identity,
                    "sessionId": session_id.strip(),
                    "messageId": message_id.strip(),
                    "transcript": text,
                    "capturedAt": captured_at,
                },
                native_request_id,
            )
            tasks[mode] = {"task_id": task_id, "idempotency_key": idempotency_key}
        return {"tasks": tasks}

    def enqueue_daily_journal(
        self,
        *,
        identity: str,
        journal_date: str,
        time_zone: str,
        sources: list[dict[str, str]],
    ) -> dict[str, str]:
        """Submit one idempotent daily journal build to the native Pi Durable owner."""
        if not sources:
            raise TaskError("daily journal requires at least one source message")
        if len(sources) > 300 or sum(len(item.get("transcript", "")) for item in sources) > 200_000:
            raise TaskError("daily journal source bundle exceeds its size limit")
        identity_key = hashlib.sha256(identity.strip().lower().encode("utf-8")).hexdigest()
        source_key = hashlib.sha256(
            json.dumps(sources, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        idempotency_key = (
            f"digital-twin:daily-journal:{identity_key}:{journal_date}:{time_zone}:{source_key}"
        )
        request_id = str(uuid.uuid5(uuid.NAMESPACE_URL, idempotency_key))
        task_id = self.owner.submit(
            "digital-twin-daily-journal",
            {
                "mode": "daily-journal",
                "identity": identity,
                "journalDate": journal_date,
                "timeZone": time_zone,
                "sources": sources,
            },
            request_id,
        )
        return {"task_id": task_id, "idempotency_key": idempotency_key}

    def list(
        self, *, identity: str, limit: int = 50, session_name: str | None = None
    ) -> list[dict[str, Any]]:
        items = self.owner.list_native(identity, min(max(limit, 1), 100))
        views = [self._native_view(item) for item in items]
        if session_name is not None:
            views = [item for item in views if item["session_name"] == session_name.strip()]
        return sorted(views, key=lambda item: item["created_at"], reverse=True)[:limit]

    def get(self, *, identity: str, task_id: str) -> dict[str, Any]:
        return self._native_view(self._get_native_owned(identity, task_id))

    def artifact(
        self, *, identity: str, task_id: str, name: str
    ) -> tuple[bytes, str, str]:
        row = self._get_native_owned(identity, task_id)
        expected_name = "workspace" if row["workspace"] == SCRATCH_WORKSPACE else "patch"
        if name != expected_name:
            raise TaskError("task artifact is unavailable")
        snapshot = self._task_result(task_id)
        execution = snapshot.get("result") if isinstance(snapshot, dict) else None
        artifacts = execution.get("artifacts") if isinstance(execution, dict) else None
        if self.artifacts is None or not isinstance(artifacts, dict):
            raise TaskError("task artifact is unavailable")
        if name not in TASK_ARTIFACTS:
            raise TaskError("task artifact is unavailable")
        filename, _ = TASK_ARTIFACTS[name]
        expected_uri = f"s3://{self.artifacts.bucket}/tasks/{task_id}/{filename}"
        if artifacts.get(name) != expected_uri:
            raise TaskError("task artifact is unavailable")
        return self.artifacts.get_task_artifact(
            task_id=task_id, name=name, max_bytes=self.settings.max_artifact_bytes
        )

    def cancel(self, *, identity: str, task_id: str) -> dict[str, Any]:
        self._get_native_owned(identity, task_id)
        self.owner.abort(task_id)
        return self._native_view(self._get_native_owned(identity, task_id))

    def _get_native_owned(self, identity: str, task_id: str) -> dict[str, Any]:
        try:
            uuid.UUID(task_id)
        except ValueError as exc:
            raise TaskError("task not found") from exc
        native = self.owner.describe(task_id)
        if native is None or native.get("identity") != identity:
            raise TaskError("task not found")
        return native

    def _native_view(self, native: dict[str, Any]) -> dict[str, Any]:
        created_at = datetime.fromisoformat(native["created_at"])
        album_key = native.get("session_album_key")
        try:
            album = album_by_key(album_key) if isinstance(album_key, str) else None
        except ValueError:
            album = None
        return {
            "id": native["task_id"],
            "identity": native["identity"],
            "instruction": native["instruction"],
            "workspace": native["workspace"],
            "session_name": native.get("session_name") or f"Pi Durable · {native['task_id'][:8]}",
            "session_reference": (
                {"artist": album.artist, "spotify_url": album.spotify_url} if album else None
            ),
            "plan_hash": plan_hash(
                {"instruction": native["instruction"], "workspace": native["workspace"]}
            ),
            "status": "submitted",
            "task_id": native["task_id"],
            "created_at": created_at,
            "expires_at": None,
            "result": native.get("result") or self._task_result(native["task_id"]),
        }

    def _task_result(self, task_id: object | None) -> dict[str, Any] | None:
        if not task_id:
            return None
        return self.owner.get(str(task_id)) or {
            "state": "pending",
            "result": None,
            "failure": None,
        }

    def progress(
        self, *, identity: str, task_id: str, after: int = 0, limit: int = 40
    ) -> list[dict[str, object]]:
        """Read safe narrated events for an owned task."""
        self._get_native_owned(identity, task_id)
        return self.owner.progress(task_id, after, min(max(limit, 1), 100))
