"""Pi Durable backed lyric and song generation lifecycle."""

from __future__ import annotations

import uuid
from typing import Any

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
from voice_agent.tasking.infrastructure.pi_durable_owner import PiDurableOwner


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

    @staticmethod
    def lyrics_task_id(generation_id: str) -> str:
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"song-lyrics:{generation_id}"))

    @staticmethod
    def render_task_id(generation_id: str) -> str:
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"song-render:{generation_id}"))

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
        request_id = self.lyrics_task_id(generation_id)
        self.owner.submit(
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
            request_id,
        )
        return self._view(self._get_owned(identity, generation_id))

    def get(self, *, identity: str, generation_id: str) -> dict[str, Any]:
        return self._view(self._get_owned(identity, generation_id))

    def render(
        self,
        *,
        identity: str,
        generation_id: str,
        trace_context: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        row = self._get_owned(identity, generation_id)
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
        self.owner.submit(
            "song-render",
            {
                "generation_id": generation_id,
                "identity": identity,
                "manifest": manifest.to_dict(),
                "trace_context": bounded_trace_context(trace_context),
            },
            self.render_task_id(generation_id),
        )
        return self._view(self._get_owned(identity, generation_id))

    def cancel(self, *, identity: str, generation_id: str) -> dict[str, Any]:
        row = self._get_owned(identity, generation_id)
        if row["cancelled_at"] is None:
            self.owner.cancel_product(row["lyrics_task_id"], identity)
            task_id = row["render_task_id"] or row["lyrics_task_id"]
            self.owner.abort(task_id)
        return self._view(self._get_owned(identity, generation_id))

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
        try:
            uuid.UUID(generation_id)
        except ValueError as exc:
            raise SongGenerationError("song generation not found") from exc
        lyrics_task_id = self.lyrics_task_id(generation_id)
        lyrics = self.owner.describe_product(lyrics_task_id)
        if (
            lyrics is None
            or lyrics.get("kind") != "song-lyrics"
            or lyrics.get("params", {}).get("identity") != identity
            or lyrics.get("params", {}).get("generation_id") != generation_id
        ):
            raise SongGenerationError("song generation not found")
        params = lyrics["params"]
        render_task_id = self.render_task_id(generation_id)
        render = self.owner.describe_product(render_task_id)
        if render is not None and (
            render.get("kind") != "song-render"
            or render.get("params", {}).get("identity") != identity
            or render.get("params", {}).get("generation_id") != generation_id
        ):
            raise SongGenerationError("song generation not found")
        return {
            "id": generation_id,
            "identity": identity,
            "brief": params["brief"],
            "workspace": params["workspace"],
            "style": params["style"],
            "duration_seconds": params["duration_seconds"],
            "lyrics_task_id": lyrics_task_id,
            "render_task_id": render_task_id if render is not None else None,
            "created_at": lyrics["created_at"],
            "render_requested_at": render["created_at"] if render is not None else None,
            "cancelled_at": lyrics["cancelled_at"],
        }

    def _snapshot(self, task_id: object) -> SongTaskSnapshot:
        snapshot = self.owner.get(str(task_id))
        return parse_song_task(snapshot) if snapshot else pending_song_task()

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
