"""Postgres-backed proposal and durable task lifecycle."""

from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg
from psycopg.rows import dict_row
from voice_agent.tasking.domain.approval import (
    ApprovalError,
    mint_approval,
    plan_hash,
    verify_approval,
)
from voice_agent.tasking.domain.session_albums import (
    album_by_key,
    least_used_album_for_session,
    session_name_for_take,
)
from voice_agent.tasking.domain.workspaces import (
    SCRATCH_WORKSPACE,
    is_scratch_workspace,
    resolve_workspace,
    validate_workspace_boundary,
)
from voice_agent.tasking.infrastructure.artifacts import TASK_ARTIFACTS, ArtifactStore
from voice_agent.tasking.infrastructure.config import Settings
from voice_agent.tasking.infrastructure.pi_durable_owner import PiDurableOwner


class ProposalError(ValueError):
    """A safe proposal lifecycle error."""


def bounded_trace_context(carrier: dict[str, str] | None) -> dict[str, str]:
    """Keep only bounded W3C context required to continue a durable trace."""
    if carrier is None:
        return {}
    return {
        key: value
        for key in ("traceparent", "tracestate")
        if isinstance((value := carrier.get(key)), str) and 0 < len(value) <= 512
    }


def persisted_plan_hash_is_valid(row: dict[str, Any]) -> bool:
    named = plan_hash(
        {
            "instruction": row["instruction"],
            "workspace": row["workspace"],
            "session_album_key": row["session_album_key"],
            "session_name": row["session_name"],
        }
    )
    album_only = plan_hash(
        {
            "instruction": row["instruction"],
            "workspace": row["workspace"],
            "session_album_key": row["session_album_key"],
        }
    )
    legacy = plan_hash(
        {"instruction": row["instruction"], "workspace": row["workspace"]}
    )
    return row["plan_hash"] in {named, album_only, legacy}


class TaskService:
    def __init__(self, settings: Settings):
        settings.require_api()
        self.settings = settings
        self.owner = PiDurableOwner(settings.pi_durable_owner_url, settings.pi_durable_owner_token_file)
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
        if is_scratch_workspace(workspace):
            return {"instruction": cleaned, "workspace": SCRATCH_WORKSPACE}
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
        for mode in ("journal", "classify"):
            idempotency_key = f"digital-twin:{mode}:{source_key}"
            native_request_id = str(uuid.uuid5(uuid.NAMESPACE_URL, idempotency_key))
            task_id = self.owner.submit(
                f"digital-twin-{mode}",
                {"mode": mode, "identity": identity, "sessionId": session_id.strip(),
                 "messageId": message_id.strip(), "transcript": text,
                 "capturedAt": captured_at},
                native_request_id,
            )
            tasks[mode] = {"task_id": task_id, "idempotency_key": idempotency_key}
        return {"tasks": tasks}

    def propose(
        self, *, identity: str, instruction: str, workspace: str
    ) -> dict[str, Any]:
        plan = self._plan(instruction, workspace)
        proposal_id = str(uuid.uuid4())
        expires_at = datetime.now(UTC) + timedelta(
            seconds=self.settings.approval_ttl_seconds
        )
        with psycopg.connect(self.settings.database_url) as conn:
            with conn.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    "SELECT pg_advisory_xact_lock(hashtext(%s))",
                    (f"session-album:{identity}",),
                )
                cursor.execute(
                    """
                    SELECT session_album_key, count(*) AS count
                    FROM voice_task_proposals
                    WHERE identity = %s
                    GROUP BY session_album_key
                    """,
                    (identity,),
                )
                usage = {
                    str(row["session_album_key"]): int(row["count"])
                    for row in cursor.fetchall()
                }
                session_album = least_used_album_for_session(proposal_id, usage)
                take = usage.get(session_album.key, 0) + 1
                session_name = session_name_for_take(session_album, take)
                digest = plan_hash(
                    {
                        **plan,
                        "session_album_key": session_album.key,
                        "session_name": session_name,
                    }
                )
                cursor.execute(
                    """
                    INSERT INTO voice_task_proposals
                        (id, identity, instruction, workspace, session_album_key,
                         session_name, plan_hash, status, expires_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, 'pending', %s)
                    RETURNING *
                    """,
                    (
                        proposal_id,
                        identity,
                        plan["instruction"],
                        plan["workspace"],
                        session_album.key,
                        session_name,
                        digest,
                        expires_at,
                    ),
                )
                row = cursor.fetchone()
        if row is None:
            raise RuntimeError("proposal insert returned no row")
        return self._view(row, include_token=True)

    def list(
        self, *, identity: str, limit: int = 50, session_name: str | None = None
    ) -> list[dict[str, Any]]:
        with psycopg.connect(self.settings.database_url) as conn:
            with conn.cursor(row_factory=dict_row) as cursor:
                if session_name is None:
                    cursor.execute(
                        """
                        SELECT * FROM voice_task_proposals
                        WHERE identity = %s
                        ORDER BY created_at DESC
                        LIMIT %s
                        """,
                        (identity, min(max(limit, 1), 100)),
                    )
                else:
                    cursor.execute(
                        """
                        SELECT * FROM voice_task_proposals
                        WHERE identity = %s AND session_name = %s
                        ORDER BY created_at DESC
                        LIMIT %s
                        """,
                        (identity, session_name.strip(), min(max(limit, 1), 100)),
                    )
                rows = cursor.fetchall()
        task_ids = list(dict.fromkeys(str(row["task_id"]) for row in rows if row["task_id"]))
        task_results = self.owner.get_many(task_ids)
        return [self._view(row, include_token=True, use_prefetched=True,
                           task_result=task_results.get(str(row["task_id"])) if row["task_id"] else None)
                for row in rows]

    def get(self, *, identity: str, proposal_id: str) -> dict[str, Any]:
        row = self._get_owned(identity, proposal_id)
        return self._view(row, include_token=True)

    def artifact(
        self, *, identity: str, proposal_id: str, name: str
    ) -> tuple[bytes, str, str]:
        """Read an artifact only after checking its proposal owner and result."""
        row = self._get_owned(identity, proposal_id)
        expected_name = "workspace" if row["workspace"] == SCRATCH_WORKSPACE else "patch"
        if name != expected_name:
            raise ProposalError("task artifact is unavailable")
        task_id = str(row["task_id"] or "")
        snapshot = self._task_result(task_id)
        execution = snapshot.get("result") if isinstance(snapshot, dict) else None
        artifacts = execution.get("artifacts") if isinstance(execution, dict) else None
        if self.artifacts is None or not isinstance(artifacts, dict):
            raise ProposalError("task artifact is unavailable")
        if name not in TASK_ARTIFACTS:
            raise ProposalError("task artifact is unavailable")
        filename, _ = TASK_ARTIFACTS[name]
        expected_uri = f"s3://{self.artifacts.bucket}/tasks/{task_id}/{filename}"
        if artifacts.get(name) != expected_uri:
            raise ProposalError("task artifact is unavailable")
        return self.artifacts.get_task_artifact(
            task_id=task_id, name=name, max_bytes=self.settings.max_artifact_bytes
        )

    def approve(
        self,
        *,
        identity: str,
        proposal_id: str,
        token: str,
        trace_context: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        try:
            claims = verify_approval(
                token, identity=identity, secret=self.settings.approval_secret
            )
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
                if claims.plan_hash != row[
                    "plan_hash"
                ] or not persisted_plan_hash_is_valid(row):
                    raise ProposalError("proposal changed after it was reviewed")
                if row["expires_at"].timestamp() < time.time():
                    raise ProposalError("proposal expired; create a new proposal")
                if row["status"] == "cancelled":
                    raise ProposalError("proposal was cancelled")
                if row["status"] == "approved" and row["task_id"]:
                    return self._view(row, include_token=False)

                task_id = self.owner.submit(
                    "agent-run",
                    {"proposal_id": str(row["id"]), "identity": identity,
                     "instruction": row["instruction"], "workspace": row["workspace"],
                     "trace_context": bounded_trace_context(trace_context)},
                    str(row["id"]),
                )
                cursor.execute(
                    """
                    UPDATE voice_task_proposals
                    SET status = 'approved', task_id = %s, approved_at = now()
                    WHERE id = %s
                    RETURNING *
                    """,
                    (task_id, proposal_id),
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
                    self.owner.abort(str(row["task_id"]))
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
        return self.owner.get(str(task_id)) or {"state": "pending", "result": None, "failure": None}

    def progress(
        self, *, identity: str, proposal_id: str, after: int = 0, limit: int = 40
    ) -> list[dict[str, object]]:
        """Read only narrated events for a proposal owned by this identity."""
        row = self._get_owned(identity, proposal_id)
        if not row["task_id"]:
            return []
        with (
            psycopg.connect(self.settings.database_url) as conn,
            conn.cursor(row_factory=dict_row) as cursor,
        ):
            if after == 0:
                cursor.execute(
                    """SELECT id, spoken, created_at FROM voice_task_progress
                       WHERE task_id = %s ORDER BY id LIMIT %s""",
                    (row["task_id"], limit),
                )
            else:
                cursor.execute(
                    """SELECT id, spoken, created_at FROM voice_task_progress
                       WHERE task_id = %s AND id > %s ORDER BY id LIMIT %s""",
                    (row["task_id"], after, limit),
                )
            rows = cursor.fetchall()
            return [
                {
                    "id": result["id"],
                    "spoken": result["spoken"],
                    "created_at": result["created_at"].isoformat(),
                }
                for result in rows
            ]

    def _view(self, row: dict[str, Any], *, include_token: bool,
              task_result: dict[str, Any] | None = None, use_prefetched: bool = False) -> dict[str, Any]:
        album = album_by_key(row["session_album_key"])
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
            "session_name": row["session_name"],
            "session_reference": {
                "artist": album.artist,
                "spotify_url": album.spotify_url,
            },
            "plan_hash": row["plan_hash"],
            "status": row["status"],
            "task_id": str(row["task_id"]) if row["task_id"] else None,
            "created_at": row["created_at"],
            "expires_at": row["expires_at"],
            "approval_token": token,
            "result": (task_result or {"state": "pending", "result": None, "failure": None})
            if use_prefetched and row["task_id"] else self._task_result(row["task_id"]),
        }
