"""Postgres-backed proposal and durable task lifecycle."""

from __future__ import annotations

import time
import uuid
from contextlib import closing
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg
from absurd_sdk import Absurd, TaskResultSnapshot
from psycopg.rows import dict_row
from voice_agent.tasking.domain.approval import (
    ApprovalError,
    mint_approval,
    plan_hash,
    verify_approval,
)
from voice_agent.tasking.domain.workspaces import (
    resolve_workspace,
    validate_workspace_boundary,
)
from voice_agent.tasking.infrastructure.artifacts import ArtifactStore
from voice_agent.tasking.infrastructure.config import Settings


class ProposalError(ValueError):
    """A safe proposal lifecycle error."""


class TaskService:
    def __init__(self, settings: Settings):
        settings.require_api()
        self.settings = settings
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
            raise ProposalError("instruction cannot be empty")
        if self.artifacts:
            resolved = self.artifacts.resolve_workspace(
                workspace, self.settings.allowed_workspaces
            )
        else:
            resolved = (
                validate_workspace_boundary(workspace, self.settings.workspace_roots)
                if self.settings.defer_workspace_validation
                else resolve_workspace(workspace, self.settings.workspace_roots)
            )
        return {"instruction": cleaned, "workspace": str(resolved)}

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
            raise ProposalError("transcript cannot be empty")
        if len(text) > 20_000:
            raise ProposalError("transcript is too large")
        if not session_id.strip() or not message_id.strip():
            raise ProposalError("session_id and message_id are required")
        source_key = f"{session_id.strip()}:{message_id.strip()}"
        tasks: dict[str, dict[str, str]] = {}
        with closing(Absurd(self.settings.database_url, queue_name=self.settings.queue)) as absurd:
            for mode in ("journal", "classify"):
                idempotency_key = f"digital-twin:{mode}:{source_key}"
                spawned = absurd.spawn(
                    f"digital-twin-{mode}",
                    {
                        "mode": mode,
                        "identity": identity,
                        "sessionId": session_id.strip(),
                        "messageId": message_id.strip(),
                        "transcript": text,
                        "capturedAt": captured_at,
                    },
                    max_attempts=3,
                    queue=self.settings.queue,
                    cancellation={"max_duration": 180},
                    idempotency_key=idempotency_key,
                )
                tasks[mode] = {
                    "task_id": str(spawned["task_id"]),
                    "idempotency_key": idempotency_key,
                }
        return {"tasks": tasks}

    def propose(self, *, identity: str, instruction: str, workspace: str) -> dict[str, Any]:
        plan = self._plan(instruction, workspace)
        proposal_id = str(uuid.uuid4())
        digest = plan_hash(plan)
        expires_at = datetime.now(UTC) + timedelta(seconds=self.settings.approval_ttl_seconds)
        with psycopg.connect(self.settings.database_url) as conn:
            with conn.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    """
                    INSERT INTO voice_task_proposals
                        (id, identity, instruction, workspace, plan_hash, status, expires_at)
                    VALUES (%s, %s, %s, %s, %s, 'pending', %s)
                    RETURNING *
                    """,
                    (
                        proposal_id,
                        identity,
                        plan["instruction"],
                        plan["workspace"],
                        digest,
                        expires_at,
                    ),
                )
                row = cursor.fetchone()
        if row is None:
            raise RuntimeError("proposal insert returned no row")
        return self._view(row, include_token=True)

    def list(self, *, identity: str, limit: int = 50) -> list[dict[str, Any]]:
        with psycopg.connect(self.settings.database_url) as conn:
            with conn.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    """
                    SELECT * FROM voice_task_proposals
                    WHERE identity = %s
                    ORDER BY created_at DESC
                    LIMIT %s
                    """,
                    (identity, min(max(limit, 1), 100)),
                )
                rows = cursor.fetchall()
        return [self._view(row, include_token=True) for row in rows]

    def get(self, *, identity: str, proposal_id: str) -> dict[str, Any]:
        row = self._get_owned(identity, proposal_id)
        return self._view(row, include_token=True)

    def approve(self, *, identity: str, proposal_id: str, token: str) -> dict[str, Any]:
        try:
            claims = verify_approval(token, identity=identity, secret=self.settings.approval_secret)
        except ApprovalError as exc:
            raise ProposalError(str(exc)) from exc
        if claims.proposal_id != proposal_id:
            raise ProposalError("approval does not match route")

        with psycopg.connect(self.settings.database_url) as conn:
            with conn.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    """
                    SELECT * FROM voice_task_proposals
                    WHERE id = %s AND identity = %s
                    FOR UPDATE
                    """,
                    (proposal_id, identity),
                )
                row = cursor.fetchone()
                if row is None:
                    raise ProposalError("proposal not found")
                actual_hash = plan_hash(
                    {"instruction": row["instruction"], "workspace": row["workspace"]}
                )
                if claims.plan_hash != row["plan_hash"] or claims.plan_hash != actual_hash:
                    raise ProposalError("proposal changed after it was reviewed")
                if row["expires_at"].timestamp() < time.time():
                    raise ProposalError("proposal expired; create a new proposal")
                if row["status"] == "cancelled":
                    raise ProposalError("proposal was cancelled")
                if row["status"] == "approved" and row["task_id"]:
                    return self._view(row, include_token=False)

                with closing(
                    Absurd(self.settings.database_url, queue_name=self.settings.queue)
                ) as absurd:
                    spawned = absurd.spawn(
                        "agent-run",
                        {
                            "proposal_id": str(row["id"]),
                            "identity": identity,
                            "instruction": row["instruction"],
                            "workspace": row["workspace"],
                        },
                        max_attempts=1,
                        queue=self.settings.queue,
                        cancellation={"max_duration": self.settings.task_timeout_seconds + 60},
                        idempotency_key=f"voice-proposal:{row['id']}",
                    )
                cursor.execute(
                    """
                    UPDATE voice_task_proposals
                    SET status = 'approved', task_id = %s, approved_at = now()
                    WHERE id = %s
                    RETURNING *
                    """,
                    (str(spawned["task_id"]), proposal_id),
                )
                approved = cursor.fetchone()
        if approved is None:
            raise RuntimeError("proposal approval returned no row")
        return self._view(approved, include_token=False)

    def cancel(self, *, identity: str, proposal_id: str) -> dict[str, Any]:
        with psycopg.connect(self.settings.database_url) as conn:
            with conn.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    """
                    SELECT * FROM voice_task_proposals
                    WHERE id = %s AND identity = %s
                    FOR UPDATE
                    """,
                    (proposal_id, identity),
                )
                row = cursor.fetchone()
                if row is None:
                    raise ProposalError("proposal not found")
                if row["status"] == "cancelled":
                    return self._view(row, include_token=False)
                if row["task_id"]:
                    with closing(
                        Absurd(self.settings.database_url, queue_name=self.settings.queue)
                    ) as absurd:
                        absurd.cancel_task(str(row["task_id"]))
                cursor.execute(
                    """
                    UPDATE voice_task_proposals
                    SET status = 'cancelled', cancelled_at = now()
                    WHERE id = %s
                    RETURNING *
                    """,
                    (proposal_id,),
                )
                row = cursor.fetchone()
        if row is None:
            raise RuntimeError("proposal cancellation returned no row")
        return self._view(row, include_token=False)

    def _get_owned(self, identity: str, proposal_id: str) -> dict[str, Any]:
        with psycopg.connect(self.settings.database_url) as conn:
            with conn.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    "SELECT * FROM voice_task_proposals WHERE id = %s AND identity = %s",
                    (proposal_id, identity),
                )
                row = cursor.fetchone()
        if row is None:
            raise ProposalError("proposal not found")
        return row

    def _task_result(self, task_id: object | None) -> dict[str, Any] | None:
        if not task_id:
            return None
        with closing(Absurd(self.settings.database_url, queue_name=self.settings.queue)) as absurd:
            snapshot: TaskResultSnapshot | None = absurd.fetch_task_result(str(task_id))
        return (
            asdict(snapshot) if snapshot else {"state": "pending", "result": None, "failure": None}
        )

    def _view(self, row: dict[str, Any], *, include_token: bool) -> dict[str, Any]:
        token = None
        if (
            include_token
            and row["status"] == "pending"
            and row["expires_at"].timestamp() >= time.time()
        ):
            token = mint_approval(
                proposal_id=str(row["id"]),
                identity=row["identity"],
                digest=row["plan_hash"],
                expires_at=int(row["expires_at"].timestamp()),
                secret=self.settings.approval_secret,
            )
        return {
            "id": str(row["id"]),
            "identity": row["identity"],
            "instruction": row["instruction"],
            "workspace": row["workspace"],
            "plan_hash": row["plan_hash"],
            "status": row["status"],
            "task_id": str(row["task_id"]) if row["task_id"] else None,
            "created_at": row["created_at"],
            "expires_at": row["expires_at"],
            "approval_token": token,
            "result": self._task_result(row["task_id"]),
        }
