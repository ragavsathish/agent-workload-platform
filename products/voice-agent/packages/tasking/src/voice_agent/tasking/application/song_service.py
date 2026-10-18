"""Durable, review-gated lyric and song generation lifecycle."""

from __future__ import annotations

import uuid
from contextlib import closing
from dataclasses import asdict
from typing import Any

import psycopg
from absurd_sdk import Absurd, TaskResultSnapshot
from psycopg.rows import dict_row
from voice_agent.tasking.application.service import bounded_trace_context
from voice_agent.tasking.domain.song_lifecycle import (
    RenderReadiness,
    SongTaskSnapshot,
    decide_render,
    parse_song_task,
    pending_song_task,
    project_song,
)
from voice_agent.tasking.domain.workspaces import (
    resolve_workspace,
    validate_workspace_boundary,
)
from voice_agent.tasking.infrastructure.artifacts import ArtifactStore
from voice_agent.tasking.infrastructure.config import Settings


class SongGenerationError(ValueError):
    """Safe song lifecycle error."""


RENDER_REJECTIONS: dict[RenderReadiness, str] = {
    "cancelled": "song generation was cancelled",
    "not_ready": "lyrics are not ready for review",
    "invalid_lyrics": "lyrics did not contain a valid song manifest",
}


class SongService:
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

    def create(
        self,
        *,
        identity: str,
        brief: str,
        workspace: str,
        style: str,
        duration_seconds: int,
        trace_context: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        cleaned_brief = brief.strip()
        cleaned_style = style.strip()
        if not cleaned_brief or len(cleaned_brief) > 20_000:
            raise SongGenerationError("song brief is outside its allowed size")
        if not cleaned_style or len(cleaned_style) > 1_000:
            raise SongGenerationError("song style is outside its allowed size")
        if not 30 <= duration_seconds <= 300:
            raise SongGenerationError("song duration must be between 30 and 300 seconds")
        if self.artifacts:
            resolved_workspace = self.artifacts.resolve_workspace(
                workspace, self.settings.allowed_workspaces
            )
        else:
            resolved_workspace = (
                validate_workspace_boundary(workspace, self.settings.workspace_roots)
                if self.settings.defer_workspace_validation
                else resolve_workspace(workspace, self.settings.workspace_roots)
            )
        generation_id = str(uuid.uuid4())
        with closing(
            Absurd(self.settings.database_url, queue_name=self.settings.queue)
        ) as absurd:
            spawned = absurd.spawn(
                "song-lyrics",
                {
                    "generation_id": generation_id,
                    "identity": identity,
                    "brief": cleaned_brief,
                    "workspace": str(resolved_workspace),
                    "style": cleaned_style,
                    "duration_seconds": duration_seconds,
                    "trace_context": bounded_trace_context(trace_context),
                },
                max_attempts=1,
                queue=self.settings.queue,
                cancellation={"max_duration": self.settings.task_timeout_seconds + 60},
                idempotency_key=f"song-lyrics:{generation_id}",
            )
        with (
            psycopg.connect(self.settings.database_url) as conn,
            conn.cursor(row_factory=dict_row) as cursor,
        ):
            cursor.execute(
                """
                INSERT INTO voice_song_generations
                    (id, identity, brief, workspace, style, duration_seconds, lyrics_task_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (
                    generation_id,
                    identity,
                    cleaned_brief,
                    str(resolved_workspace),
                    cleaned_style,
                    duration_seconds,
                    str(spawned["task_id"]),
                ),
            )
            row = cursor.fetchone()
        if row is None:
            raise RuntimeError("song generation insert returned no row")
        return self._view(row)

    def get(self, *, identity: str, generation_id: str) -> dict[str, Any]:
        return self._view(self._get_owned(identity, generation_id))

    def render(
        self,
        *,
        identity: str,
        generation_id: str,
        trace_context: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        with (
            psycopg.connect(self.settings.database_url) as conn,
            conn.cursor(row_factory=dict_row) as cursor,
        ):
            cursor.execute(
                """
                SELECT * FROM voice_song_generations
                WHERE id = %s AND identity = %s
                FOR UPDATE
                """,
                (generation_id, identity),
            )
            row = cursor.fetchone()
            if row is None:
                raise SongGenerationError("song generation not found")
            lyrics = self._snapshot(row["lyrics_task_id"])
            readiness, manifest = decide_render(
                cancelled=row["cancelled_at"] is not None,
                render_requested=bool(row["render_task_id"]),
                lyrics=lyrics,
            )
            if readiness == "already_requested":
                return self._view(row)
            if rejection := RENDER_REJECTIONS.get(readiness):
                raise SongGenerationError(rejection)
            if readiness != "ready" or manifest is None:
                raise RuntimeError("ready song render decision omitted its manifest")
            with closing(
                Absurd(self.settings.database_url, queue_name=self.settings.queue)
            ) as absurd:
                spawned = absurd.spawn(
                    "song-render",
                    {
                        "generation_id": generation_id,
                        "identity": identity,
                        "manifest": manifest.to_dict(),
                        "trace_context": bounded_trace_context(trace_context),
                    },
                    max_attempts=1,
                    queue=self.settings.queue,
                    cancellation={
                        "max_duration": self.settings.music_generation_timeout_seconds + 180
                    },
                    idempotency_key=f"song-render:{generation_id}",
                )
            cursor.execute(
                """
                UPDATE voice_song_generations
                SET render_task_id = %s, render_requested_at = now()
                WHERE id = %s
                RETURNING *
                """,
                (str(spawned["task_id"]), generation_id),
            )
            row = cursor.fetchone()
        if row is None:
            raise RuntimeError("song render update returned no row")
        return self._view(row)

    def cancel(self, *, identity: str, generation_id: str) -> dict[str, Any]:
        with (
            psycopg.connect(self.settings.database_url) as conn,
            conn.cursor(row_factory=dict_row) as cursor,
        ):
            cursor.execute(
                """
                SELECT * FROM voice_song_generations
                WHERE id = %s AND identity = %s
                FOR UPDATE
                """,
                (generation_id, identity),
            )
            row = cursor.fetchone()
            if row is None:
                raise SongGenerationError("song generation not found")
            if row["cancelled_at"] is None:
                with closing(
                    Absurd(self.settings.database_url, queue_name=self.settings.queue)
                ) as absurd:
                    task_id = row["render_task_id"] or row["lyrics_task_id"]
                    absurd.cancel_task(str(task_id))
                cursor.execute(
                    """
                    UPDATE voice_song_generations
                    SET cancelled_at = now()
                    WHERE id = %s
                    RETURNING *
                    """,
                    (generation_id,),
                )
                row = cursor.fetchone()
        if row is None:
            raise RuntimeError("song cancellation returned no row")
        return self._view(row)

    def audio(self, *, identity: str, generation_id: str) -> bytes:
        if self.artifacts is None:
            raise SongGenerationError("song artifact store is unavailable")
        view = self._view(self._get_owned(identity, generation_id))
        uri = view.get("audio_artifact")
        if view["status"] != "complete" or not isinstance(uri, str):
            raise SongGenerationError("song audio is not ready")
        try:
            return self.artifacts.get_song(uri)
        except ValueError as exc:
            raise SongGenerationError(str(exc)) from exc

    def _get_owned(self, identity: str, generation_id: str) -> dict[str, Any]:
        with (
            psycopg.connect(self.settings.database_url) as conn,
            conn.cursor(row_factory=dict_row) as cursor,
        ):
            cursor.execute(
                "SELECT * FROM voice_song_generations WHERE id = %s AND identity = %s",
                (generation_id, identity),
            )
            row = cursor.fetchone()
        if row is None:
            raise SongGenerationError("song generation not found")
        return row

    def _snapshot(self, task_id: object) -> SongTaskSnapshot:
        with closing(
            Absurd(self.settings.database_url, queue_name=self.settings.queue)
        ) as absurd:
            snapshot: TaskResultSnapshot | None = absurd.fetch_task_result(str(task_id))
        return (
            parse_song_task(asdict(snapshot))
            if snapshot
            else pending_song_task()
        )

    def _view(self, row: dict[str, Any]) -> dict[str, Any]:
        lyrics = self._snapshot(row["lyrics_task_id"])
        render = self._snapshot(row["render_task_id"]) if row["render_task_id"] else None
        status, manifest, artifact, failure = project_song(
            cancelled=row["cancelled_at"] is not None,
            lyrics=lyrics,
            render=render,
        )
        return {
            "id": str(row["id"]),
            "status": status,
            "brief": row["brief"],
            "style": row["style"],
            "duration_seconds": row["duration_seconds"],
            "lyrics_task_id": str(row["lyrics_task_id"]),
            "render_task_id": str(row["render_task_id"]) if row["render_task_id"] else None,
            "manifest": manifest.to_dict() if manifest else None,
            "audio_artifact": artifact,
            "audio_path": f"/api/music/generations/{row['id']}/audio" if artifact else None,
            "failure": failure,
            "created_at": row["created_at"],
            "render_requested_at": row["render_requested_at"],
        }
