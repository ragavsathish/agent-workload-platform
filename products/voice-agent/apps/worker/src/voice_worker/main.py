"""Pi task execution helpers used by the native durable owner."""

from __future__ import annotations

import json
import logging
import os
import pwd
import subprocess
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, cast

import psycopg
from opentelemetry.context import attach, detach
from opentelemetry.propagate import extract
from voice_agent.shared.telemetry import configure_telemetry
from voice_agent.tasking.domain.song_generation import (
    SongManifest,
    validate_song_manifest,
)
from voice_agent.tasking.infrastructure.ace_step import create_ace_step_renderer
from voice_agent.tasking.infrastructure.artifacts import ArtifactStore
from voice_agent.tasking.infrastructure.config import Settings
from voice_agent.tasking.infrastructure.ensure_execution_image import ensure_execution_image

telemetry = configure_telemetry("pipecat-task-worker")
logger = logging.getLogger(__name__)


DATABASE_RETRY_DELAY_SECONDS = 2.0
MAX_TASK_PROGRESS_EVENTS = 2_000


type RenderSong = Callable[[SongManifest], bytes]
type StoreSong = Callable[[str, bytes], dict[str, str]]


def prepare_repository_image(
    settings: Settings, *, workspace: Path, workspace_reference: str
) -> str | None:
    if settings.pi_execution_mode == "host":
        return None
    with telemetry.observe("agent-task.image-ensure"):
        return ensure_execution_image(
            settings, workspace=workspace, workspace_reference=workspace_reference
        )


def create_song_renderer(settings: Settings) -> RenderSong | None:
    """Construct the effectful music adapter once at the worker edge."""
    if not settings.music_generation_enabled:
        return None
    return create_ace_step_renderer(
        base_url=settings.music_generation_base_url,
        timeout_seconds=settings.music_generation_timeout_seconds,
        ffmpeg_binary=settings.music_ffmpeg_binary,
    )


def create_song_writer(artifacts: ArtifactStore | None) -> StoreSong | None:
    if artifacts is None:
        return None

    def store(generation_id: str, audio: bytes) -> dict[str, str]:
        return artifacts.put_song(generation_id=generation_id, audio=audio)

    return store


@contextmanager
def continue_task_trace(params: dict[str, Any]) -> Iterator[None]:
    """Continue bounded W3C context carried by one durable task envelope."""
    candidate = params.get("trace_context")
    carrier = (
        {
            key: value
            for key in ("traceparent", "tracestate")
            if isinstance((value := candidate.get(key)), str) and 0 < len(value) <= 512
        }
        if isinstance(candidate, dict)
        else {}
    )
    token = attach(extract(carrier))
    try:
        yield
    finally:
        detach(token)


def scratch_root_reaches_account_home(scratch_root: Path, account_home: Path) -> bool:
    return scratch_root.resolve().is_relative_to(account_home.resolve())


def validate_worker(settings: Settings) -> None:
    settings.require_api()
    if settings.pi_execution_mode not in {"gondolin", "host"}:
        raise RuntimeError("WORKER_PI_EXECUTION_MODE must be 'gondolin' or 'host'")
    if settings.skills_dir and not settings.skills_dir.is_dir():
        raise RuntimeError(f"Skills directory not found: {settings.skills_dir}")
    account_home = Path(pwd.getpwuid(os.getuid()).pw_dir)
    if scratch_root_reaches_account_home(settings.worker_scratch_root, account_home):
        raise RuntimeError(
            "WORKER_SCRATCH_ROOT must be outside the account home so Pi cannot "
            "discover ancestor skills"
        )
    settings.worker_scratch_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(settings.worker_scratch_root, 0o700)
    if settings.music_generation_enabled and not Path(settings.music_ffmpeg_binary).is_file():
        raise RuntimeError(f"FFmpeg binary not found: {settings.music_ffmpeg_binary}")


def task_progress_publisher(database_url: str, task_id: str) -> Callable[[str], None]:
    """Persist a bounded owner-readable feed of safe task action summaries."""
    emitted = 0
    last_spoken = ""
    last_at = 0.0

    def publish(spoken: str) -> None:
        nonlocal emitted, last_spoken, last_at
        now = time.monotonic()
        if emitted >= MAX_TASK_PROGRESS_EVENTS or (spoken == last_spoken and now - last_at < 8):
            return
        try:
            with psycopg.connect(database_url) as conn:
                conn.execute(
                    "INSERT INTO voice_task_progress (task_id, spoken) VALUES (%s, %s)",
                    (task_id, spoken),
                )
        except psycopg.Error:
            logger.warning("Unable to store task progress", exc_info=True)
            return
        emitted += 1
        last_spoken = spoken
        last_at = now

    return publish


def run_digital_twin(settings: Settings, payload: dict[str, Any]) -> dict[str, Any]:
    if settings.digital_twin_runner is None:
        raise RuntimeError("DIGITAL_TWIN_RUNNER is required for digital twin tasks")
    completed = subprocess.run(
        [settings.node_binary, str(settings.digital_twin_runner)],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        timeout=settings.digital_twin_timeout_seconds,
        check=False,
        env=os.environ.copy(),
    )
    if completed.returncode != 0:
        raise RuntimeError(
            f"digital twin runner exited with {completed.returncode}: "
            f"{completed.stderr[-2_000:]}"
        )
    result = json.loads(completed.stdout)
    if not isinstance(result, dict):
        raise RuntimeError("digital twin runner returned an invalid result")
    return cast(dict[str, Any], result)


def run_song_render(
    render_song: RenderSong | None,
    store_song: StoreSong | None,
    *,
    generation_id: str,
    manifest_payload: object,
) -> dict[str, Any]:
    if render_song is None:
        raise RuntimeError("MUSIC_GENERATION_BASE_URL is required for song rendering")
    if store_song is None:
        raise RuntimeError("song rendering requires the S3-compatible artifact store")
    manifest = validate_song_manifest(manifest_payload)
    audio = render_song(manifest)
    return {
        "manifest": manifest.to_dict(),
        "artifacts": store_song(generation_id, audio),
    }


def record_journal_decision(result: dict[str, Any]) -> None:
    """Emit only bounded journal decision metrics, never transcript or entry text."""
    if result.get("mode") != "journal":
        return
    decision = result.get("decision")
    if not isinstance(decision, dict):
        return
    outcome = decision.get("outcome")
    if outcome not in {"filtered", "no-entries", "written"}:
        outcome = "invalid"
    telemetry.record("digital_twin.journal.decision", outcome=outcome)
    for field, operation in (
        ("inputSentences", "digital_twin.journal.sentences.input"),
        ("eligibleSentences", "digital_twin.journal.sentences.eligible"),
        ("modelEntries", "digital_twin.journal.entries.model"),
        ("groundedEntries", "digital_twin.journal.entries.written"),
        ("rejectedEntries", "digital_twin.journal.entries.rejected"),
    ):
        count = decision.get(field)
        if isinstance(count, int) and 0 < count <= 100:
            telemetry.record(operation, count=count)
