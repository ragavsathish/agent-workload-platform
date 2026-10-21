"""Pure song lifecycle decisions and bounded public projections."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, cast

from voice_agent.tasking.domain.song_generation import (
    SongManifest,
    manifest_from_pi_result,
)

type TaskState = Literal[
    "pending", "running", "sleeping", "completed", "failed", "cancelled"
]
type SongStatus = Literal[
    "writing_lyrics", "lyrics_ready", "generating_music", "complete", "failed", "cancelled"
]
type RenderReadiness = Literal[
    "ready", "already_requested", "cancelled", "not_ready", "invalid_lyrics"
]
type SongTaskSnapshot = tuple[TaskState, dict[str, Any] | None]
type RenderDecision = tuple[RenderReadiness, SongManifest | None]
type SongProjection = tuple[SongStatus, SongManifest | None, str | None, str | None]

TASK_STATES = frozenset({"pending", "running", "sleeping", "completed", "failed", "cancelled"})
ACTIVE_TASK_STATES = frozenset({"pending", "running", "sleeping"})


def pending_song_task() -> SongTaskSnapshot:
    return "pending", None


def parse_song_task(value: Mapping[str, object]) -> SongTaskSnapshot:
    """Parse an infrastructure snapshot into a small immutable domain value."""
    state_value = str(value.get("state", "pending"))
    if state_value not in TASK_STATES:
        raise ValueError("song task snapshot has an invalid state")
    result_value = value.get("result")
    result = dict(result_value) if isinstance(result_value, Mapping) else None
    return cast(TaskState, state_value), result


def _manifest(lyrics: SongTaskSnapshot) -> SongManifest | None:
    state, result = lyrics
    if state != "completed":
        return None
    try:
        return manifest_from_pi_result(result)
    except (TypeError, ValueError):
        return None


def _audio_artifact(render: SongTaskSnapshot | None) -> str | None:
    if render is None:
        return None
    state, result = render
    if state != "completed" or result is None:
        return None
    artifacts = result.get("artifacts")
    if not isinstance(artifacts, Mapping):
        return None
    audio = artifacts.get("audio")
    return audio if isinstance(audio, str) and audio.startswith("s3://") else None


def decide_render(
    *,
    cancelled: bool,
    render_requested: bool,
    lyrics: SongTaskSnapshot,
) -> RenderDecision:
    """Decide whether the reviewed lyric manifest may cross the render seam."""
    manifest = _manifest(lyrics)
    match cancelled, render_requested, lyrics[0], manifest:
        case True, _, _, _:
            return "cancelled", None
        case _, True, _, _:
            return "already_requested", None
        case _, _, "completed", SongManifest():
            return "ready", manifest
        case _, _, "completed", None:
            return "invalid_lyrics", None
        case _:
            return "not_ready", None


def project_song(
    *,
    cancelled: bool,
    lyrics: SongTaskSnapshot,
    render: SongTaskSnapshot | None,
) -> SongProjection:
    """Project internal task state into one bounded, sanitized public view."""
    lyric_state, _ = lyrics
    render_state = render[0] if render else None
    manifest = _manifest(lyrics)
    artifact = _audio_artifact(render)
    match cancelled, render_state, lyric_state, manifest, artifact:
        case True, _, _, _, _:
            status: SongStatus = "cancelled"
        case _, state, _, _, _ if state in ACTIVE_TASK_STATES:
            status = "generating_music"
        case _, "completed", _, SongManifest(), str():
            status = "complete"
        case _, "cancelled", _, _, _:
            status = "cancelled"
        case _, str(), _, _, _:
            status = "failed"
        case _, None, state, _, _ if state in ACTIVE_TASK_STATES:
            status = "writing_lyrics"
        case _, None, "completed", SongManifest(), _:
            status = "lyrics_ready"
        case _, None, "cancelled", _, _:
            status = "cancelled"
        case _:
            status = "failed"

    failure = None
    if status == "failed":
        failure = "song rendering failed" if render is not None else "lyric generation failed"
    return status, manifest, artifact if status == "complete" else None, failure
