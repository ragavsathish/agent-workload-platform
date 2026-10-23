"""Absurd worker that runs one durable Pi session per approved task."""

from __future__ import annotations

import json
import logging
import os
import pwd
import subprocess
import tempfile
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, cast

import psycopg
from absurd_sdk import Absurd, TaskContext
from opentelemetry.context import attach, detach
from opentelemetry.propagate import extract, inject
from psycopg import OperationalError
from voice_agent.shared.telemetry import configure_telemetry
from voice_agent.tasking.application.pi_response import (
    parse_pi_event_stream,
    presentation_prompt,
)
from voice_agent.tasking.domain.song_generation import (
    SongManifest,
    lyric_prompt,
    manifest_from_pi_result,
    validate_song_manifest,
)
from voice_agent.tasking.domain.task_progress import narration_from_pi_record
from voice_agent.tasking.domain.workspaces import is_scratch_workspace, resolve_workspace
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


def build_pi_command(settings: Settings, *, task_id: str) -> list[str]:
    if settings.gondolin_extension and settings.skills_dir is None:
        raise RuntimeError("PI_TASK_SKILLS_DIR is required for Gondolin task sessions")
    command = [
        settings.pi_binary,
        "--mode",
        "rpc",
        "--session-id",
        task_id,
        "--session-dir",
        str(settings.pi_session_dir),
        "--thinking",
        settings.pi_thinking,
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--approve",
    ]
    if settings.skills_dir:
        command.extend(["--skill", str(settings.skills_dir)])
    if settings.pi_model:
        command.extend(["--model", settings.pi_model])
    if settings.gondolin_extension:
        command.extend(["--no-builtin-tools", "--extension", str(settings.gondolin_extension)])
    elif not settings.allow_unsandboxed:
        raise RuntimeError("PI_GONDOLIN_EXTENSION is required unless WORKER_ALLOW_UNSANDBOXED=true")
    return command


def build_rpc_command(settings: Settings, *, task_id: str) -> list[str]:
    return [
        str(settings.pi_rpc_host_binary),
        "--socket-dir",
        str(settings.pi_rpc_socket_dir),
        "--task-id",
        task_id,
        "--idle-seconds",
        str(settings.pi_rpc_idle_seconds),
        "--timeout-seconds",
        str(settings.task_timeout_seconds),
        "--",
        *build_pi_command(settings, task_id=task_id),
    ]


def scratch_root_reaches_account_home(scratch_root: Path, account_home: Path) -> bool:
    return scratch_root.resolve().is_relative_to(account_home.resolve())


def validate_worker(settings: Settings) -> None:
    settings.require_api()
    if not Path(settings.pi_binary).is_file():
        raise RuntimeError(f"Pi binary not found: {settings.pi_binary}")
    if not settings.pi_rpc_host_binary.is_file():
        raise RuntimeError(f"Pi RPC host binary not found: {settings.pi_rpc_host_binary}")
    if settings.gondolin_extension and not settings.gondolin_extension.is_file():
        raise RuntimeError(f"Gondolin extension not found: {settings.gondolin_extension}")
    if settings.gondolin_extension and settings.skills_dir is None:
        raise RuntimeError("PI_TASK_SKILLS_DIR is required for Gondolin task sessions")
    if settings.skills_dir and not settings.skills_dir.is_dir():
        raise RuntimeError(f"Skills directory not found: {settings.skills_dir}")
    if not settings.gondolin_extension and not settings.allow_unsandboxed:
        raise RuntimeError("secure worker requires PI_GONDOLIN_EXTENSION")
    account_home = Path(pwd.getpwuid(os.getuid()).pw_dir)
    if scratch_root_reaches_account_home(settings.worker_scratch_root, account_home):
        raise RuntimeError(
            "WORKER_SCRATCH_ROOT must be outside the account home so Pi cannot "
            "discover ancestor skills"
        )
    settings.worker_scratch_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(settings.worker_scratch_root, 0o700)
    settings.pi_session_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(settings.pi_session_dir, 0o700)
    settings.pi_rpc_socket_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(settings.pi_rpc_socket_dir, 0o700)
    if settings.pi_rpc_idle_seconds < 0 or settings.pi_rpc_idle_seconds > 300:
        raise RuntimeError("PI_TASK_RPC_IDLE_SECONDS must be between 0 and 300")
    if settings.music_generation_enabled and not Path(settings.music_ffmpeg_binary).is_file():
        raise RuntimeError(f"FFmpeg binary not found: {settings.music_ffmpeg_binary}")


def run_pi(
    settings: Settings,
    *,
    task_id: str,
    instruction: str,
    workspace: Path,
    image_ref: str | None = None,
    on_progress: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    with telemetry.observe("agent-task.pi-rpc"):
        command = build_rpc_command(settings, task_id=task_id)
        process_environment = os.environ.copy()
        if settings.skills_dir is not None:
            process_environment["PI_TASK_SKILLS_DIR"] = str(settings.skills_dir)
        if image_ref is not None:
            process_environment["GONDOLIN_EXECUTION_IMAGE_REF"] = image_ref
        else:
            process_environment.pop("GONDOLIN_EXECUTION_IMAGE_REF", None)
        trace_carrier: dict[str, str] = {}
        inject(trace_carrier)
        if traceparent := trace_carrier.get("traceparent"):
            process_environment["TRACEPARENT"] = traceparent
        if tracestate := trace_carrier.get("tracestate"):
            process_environment["TRACESTATE"] = tracestate
        with tempfile.TemporaryFile() as stdout_file, tempfile.TemporaryFile() as stderr_file:
            process = subprocess.Popen(
                command,
                cwd=workspace,
                env=process_environment,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=stderr_file,
            )
            deadline = settings.task_timeout_seconds + 10
            timed_out = threading.Event()

            def stop_on_timeout() -> None:
                if process.poll() is None:
                    timed_out.set()
                    process.kill()

            timer = threading.Timer(deadline, stop_on_timeout)
            timer.start()
            try:
                assert process.stdin is not None and process.stdout is not None
                process.stdin.write(presentation_prompt(instruction).encode("utf-8"))
                process.stdin.close()
                for line in process.stdout:
                    stdout_file.write(line)
                    narration = narration_from_pi_record(line)
                    if narration and on_progress:
                        on_progress(narration)
                exit_code = process.wait()
            finally:
                timer.cancel()
                if process.poll() is None:
                    process.kill()
                    process.wait()
                if process.stdout is not None:
                    process.stdout.close()
            if timed_out.is_set():
                raise subprocess.TimeoutExpired(command, deadline)

            def tail(file) -> str:
                file.seek(0, os.SEEK_END)
                file.seek(max(file.tell() - settings.max_output_bytes, 0))
                return file.read().decode("utf-8", errors="replace")

            stderr = tail(stderr_file)
            if exit_code != 0:
                raise RuntimeError(
                    f"Pi RPC host exited with {exit_code}: {stderr[-2000:]}"
                )
            stdout_file.seek(0)
            response = parse_pi_event_stream(stdout_file)
    return {
        "exit_code": exit_code,
        "response": {
            "text": response.text,
            "spoken": response.spoken,
            "presentation": response.presentation,
            "resourceUri": response.resource_uri,
        },
    }


def task_progress_publisher(database_url: str, task_id: str) -> Callable[[str], None]:
    """Persist a bounded owner-readable feed of safe task action summaries."""
    emitted = 0
    last_spoken = ""
    last_at = 0.0
    started = False

    def publish(spoken: str) -> None:
        nonlocal emitted, last_spoken, last_at, started
        now = time.monotonic()
        if emitted >= MAX_TASK_PROGRESS_EVENTS or (spoken == last_spoken and now - last_at < 8):
            return
        if spoken == "The agent has started working." and started:
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
        if spoken == "The agent has started working.":
            started = True

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


def run_song_lyrics(
    settings: Settings,
    *,
    task_id: str,
    brief: str,
    style: str,
    duration_seconds: int,
    workspace: Path,
    image_ref: str | None = None,
) -> dict[str, Any]:
    result = run_pi(
        settings,
        task_id=task_id,
        instruction=lyric_prompt(
            brief=brief,
            style=style,
            duration_seconds=duration_seconds,
        ),
        workspace=workspace,
        image_ref=image_ref,
    )
    manifest = manifest_from_pi_result(result)
    return {**result, "manifest": manifest.to_dict()}


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


def create_worker(settings: Settings) -> Absurd:
    validate_worker(settings)
    absurd = Absurd(settings.database_url, queue_name=settings.queue, default_max_attempts=1)
    artifacts = (
        ArtifactStore(
            endpoint_url=settings.artifact_endpoint_url,
            bucket=settings.artifact_bucket,
            access_key=settings.artifact_access_key,
            secret_key=settings.artifact_secret_key,
        )
        if settings.artifact_workspaces
        else None
    )
    song_renderer = create_song_renderer(settings)
    song_writer = create_song_writer(artifacts)

    @absurd.register_task(
        "agent-run",
        queue=settings.queue,
        default_max_attempts=1,
        default_cancellation={
            "max_duration": settings.image_build_timeout_seconds + settings.task_timeout_seconds + 60
        },
    )
    def agent_run(params: dict[str, Any], ctx: TaskContext) -> dict[str, Any]:
        with continue_task_trace(params):
            with telemetry.observe("task.run"):
                return run_agent_task(params, ctx)

    def run_digital_twin_ingestion(
        params: dict[str, Any], ctx: TaskContext
    ) -> dict[str, Any]:
        with telemetry.observe("digital_twin.ingest"):
            result = cast(
                dict[str, Any],
                ctx.step("run-digital-twin-vm", lambda: run_digital_twin(settings, params)),
            )
            record_journal_decision(result)
            return result

    for task_name in (
        "digital-twin-journal",
        "digital-twin-classify",
        "digital-twin-ingest",  # Drain tasks created before the fan-out migration.
    ):
        absurd.register_task(
            task_name,
            queue=settings.queue,
            default_max_attempts=3,
            default_cancellation={"max_duration": settings.digital_twin_timeout_seconds + 30},
        )(run_digital_twin_ingestion)

    @absurd.register_task(
        "song-lyrics",
        queue=settings.queue,
        default_max_attempts=1,
        default_cancellation={
            "max_duration": settings.image_build_timeout_seconds + settings.task_timeout_seconds + 60
        },
    )
    def song_lyrics(params: dict[str, Any], ctx: TaskContext) -> dict[str, Any]:
        with continue_task_trace(params):
            with telemetry.observe("song.lyrics"):
                task_id = str(ctx.task_id)
                def run_in_workspace(workspace: Path) -> dict[str, Any]:
                    image_ref = ctx.step(
                        "ensure-execution-image",
                        lambda: prepare_repository_image(
                            settings,
                            workspace=workspace,
                            workspace_reference=str(params["workspace"]),
                        ),
                    )
                    intent = ctx.begin_step("lyrics-intent")
                    if intent.done:
                        return {
                            "state": "needs_manual_reconciliation",
                            "session_id": task_id,
                            "message": "Pi lyric generation started previously without a result; not rerun.",
                        }
                    ctx.complete_step(intent, {"started": True, "session_id": task_id})
                    return run_song_lyrics(
                        settings,
                        task_id=task_id,
                        brief=str(params["brief"]),
                        style=str(params["style"]),
                        duration_seconds=int(params["duration_seconds"]),
                        workspace=workspace,
                        image_ref=image_ref,
                    )

                if artifacts:
                    with artifacts.materialize_workspace(
                        str(params["workspace"]), settings.worker_scratch_root
                    ) as workspace:
                        return run_in_workspace(workspace)
                return run_in_workspace(
                    resolve_workspace(str(params["workspace"]), settings.workspace_roots)
                )

    @absurd.register_task(
        "song-render",
        queue=settings.queue,
        default_max_attempts=1,
        default_cancellation={
            "max_duration": settings.music_generation_timeout_seconds + 180
        },
    )
    def song_render(params: dict[str, Any], ctx: TaskContext) -> dict[str, Any]:
        with continue_task_trace(params):
            with telemetry.observe("song.render"):
                intent = ctx.begin_step("render-intent")
                if intent.done:
                    return {
                        "state": "needs_manual_reconciliation",
                        "message": "Music generation started previously without a result; not rerun.",
                    }
                ctx.complete_step(intent, {"started": True})
                return run_song_render(
                    song_renderer,
                    song_writer,
                    generation_id=str(params["generation_id"]),
                    manifest_payload=params.get("manifest"),
                )

    def run_agent_task(params: dict[str, Any], ctx: TaskContext) -> dict[str, Any]:
        task_id = str(ctx.task_id)
        progress = task_progress_publisher(settings.database_url, task_id)
        run_handle = ctx.begin_step("run-pi")
        if run_handle.done:
            return cast(dict[str, Any], run_handle.state)

        def checkpoint_pi_intent() -> dict[str, Any] | None:
            # Pi's arbitrary side effects cannot be made transactional with Postgres, so persist
            # this intent immediately before Pi starts.
            intent = ctx.begin_step("run-intent")
            if intent.done:
                return {
                    "state": "needs_manual_reconciliation",
                    "session_id": task_id,
                    "message": "Pi started previously but did not checkpoint a result; not rerun.",
                }
            ctx.complete_step(intent, {"started": True, "session_id": task_id})
            return None

        if is_scratch_workspace(str(params["workspace"])):
            if settings.gondolin_extension is None:
                raise RuntimeError("scratch tasks require PI_GONDOLIN_EXTENSION")
            with tempfile.TemporaryDirectory(
                prefix=f"task-{task_id}-", dir=settings.worker_scratch_root
            ) as temporary:
                progress("Preparing the task workspace.")
                workspace = Path(temporary)
                reconciliation = checkpoint_pi_intent()
                if reconciliation:
                    return reconciliation
                result = run_pi(
                    settings,
                    task_id=task_id,
                    instruction=str(params["instruction"]),
                    workspace=workspace,
                    image_ref=settings.scratch_image_ref or None,
                    on_progress=progress,
                )
                if artifacts:
                    result["artifacts"] = artifacts.capture_scratch_result(
                        task_id=task_id,
                        workspace=workspace,
                        execution=result,
                        max_bytes=settings.max_artifact_bytes,
                    )
        elif artifacts:
            progress("Preparing the task workspace and image.")
            with artifacts.materialize_workspace(
                str(params["workspace"]), settings.worker_scratch_root
            ) as workspace:
                image_ref = ctx.step(
                    "ensure-execution-image",
                    lambda: prepare_repository_image(
                        settings,
                        workspace=workspace,
                        workspace_reference=str(params["workspace"]),
                    ),
                )
                reconciliation = checkpoint_pi_intent()
                if reconciliation:
                    return reconciliation
                result = run_pi(
                    settings,
                    task_id=task_id,
                    instruction=str(params["instruction"]),
                    workspace=workspace,
                    image_ref=image_ref,
                    on_progress=progress,
                )
                result["artifacts"] = artifacts.capture_result(
                    task_id=task_id,
                    workspace=workspace,
                    execution=result,
                    max_bytes=settings.max_artifact_bytes,
                )
        else:
            progress("Preparing the task workspace and image.")
            workspace = ctx.step(
                "prepare-workspace",
                lambda: str(
                    resolve_workspace(str(params["workspace"]), settings.workspace_roots)
                ),
            )
            image_ref = ctx.step(
                "ensure-execution-image",
                lambda: prepare_repository_image(
                    settings,
                    workspace=Path(workspace),
                    workspace_reference=str(params["workspace"]),
                ),
            )
            reconciliation = checkpoint_pi_intent()
            if reconciliation:
                return reconciliation
            result = run_pi(
                settings,
                task_id=task_id,
                instruction=str(params["instruction"]),
                workspace=Path(workspace),
                image_ref=image_ref,
                on_progress=progress,
            )
        return ctx.complete_step(run_handle, result)

    return absurd


def run_worker(settings: Settings) -> None:
    """Keep the durable worker alive across brief database lifecycle outages."""
    while True:
        worker: Absurd | None = None
        try:
            worker = create_worker(settings)
            worker.start_worker(concurrency=1)
            return
        except OperationalError as error:
            logger.warning(
                "PostgreSQL connection unavailable; retrying worker in %.1f seconds: %s",
                DATABASE_RETRY_DELAY_SECONDS,
                error,
            )
            time.sleep(DATABASE_RETRY_DELAY_SECONDS)
        finally:
            if worker is not None:
                try:
                    worker.close()
                except OperationalError:
                    logger.warning("PostgreSQL connection closed during worker cleanup")


def main() -> None:
    settings = Settings.from_env()
    run_worker(settings)


if __name__ == "__main__":
    main()
