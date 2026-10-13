"""Absurd worker that runs one durable Pi session per approved task."""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any, cast

from absurd_sdk import Absurd, TaskContext
from dotenv import load_dotenv

from voice_agent.tasking.application.pi_response import parse_pi_event_stream, presentation_prompt
from voice_agent.tasking.domain.workspaces import resolve_workspace
from voice_agent.tasking.infrastructure.artifacts import ArtifactStore
from voice_agent.tasking.infrastructure.config import Settings


def build_pi_command(settings: Settings, *, task_id: str, instruction: str) -> list[str]:
    command = [
        settings.pi_binary,
        "--mode",
        "json",
        "--print",
        "--no-session",
        "--thinking",
        settings.pi_thinking,
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--approve",
    ]
    if settings.pi_model:
        command.extend(["--model", settings.pi_model])
    if settings.gondolin_extension:
        command.extend(["--no-builtin-tools", "--extension", str(settings.gondolin_extension)])
    elif not settings.allow_unsandboxed:
        raise RuntimeError("PI_GONDOLIN_EXTENSION is required unless WORKER_ALLOW_UNSANDBOXED=true")
    command.extend(["--", presentation_prompt(instruction)])
    return command


def validate_worker(settings: Settings) -> None:
    settings.require_api()
    if not Path(settings.pi_binary).is_file():
        raise RuntimeError(f"Pi binary not found: {settings.pi_binary}")
    if settings.gondolin_extension and not settings.gondolin_extension.is_file():
        raise RuntimeError(f"Gondolin extension not found: {settings.gondolin_extension}")
    if not settings.gondolin_extension and not settings.allow_unsandboxed:
        raise RuntimeError("secure worker requires PI_GONDOLIN_EXTENSION")
    if settings.artifact_workspaces:
        settings.worker_scratch_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(settings.worker_scratch_root, 0o700)


def run_pi(
    settings: Settings, *, task_id: str, instruction: str, workspace: Path
) -> dict[str, Any]:
    command = build_pi_command(settings, task_id=task_id, instruction=instruction)
    with tempfile.TemporaryFile() as stdout_file, tempfile.TemporaryFile() as stderr_file:
        completed = subprocess.run(
            command,
            cwd=workspace,
            env=os.environ.copy(),
            stdin=subprocess.DEVNULL,
            stdout=stdout_file,
            stderr=stderr_file,
            timeout=settings.task_timeout_seconds,
            check=False,
        )

        def tail(file) -> str:
            file.seek(0, os.SEEK_END)
            file.seek(max(file.tell() - settings.max_output_bytes, 0))
            return file.read().decode("utf-8", errors="replace")

        stderr = tail(stderr_file)
        if completed.returncode != 0:
            raise RuntimeError(f"Pi exited with {completed.returncode}: {stderr[-2000:]}")
        stdout_file.seek(0)
        response = parse_pi_event_stream(stdout_file)
    return {
        "exit_code": completed.returncode,
        "response": {
            "text": response.text,
            "spoken": response.spoken,
            "mermaid": response.mermaid,
        },
    }


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

    @absurd.register_task(
        "agent-run",
        queue=settings.queue,
        default_max_attempts=1,
        default_cancellation={"max_duration": settings.task_timeout_seconds + 60},
    )
    def agent_run(params: dict[str, Any], ctx: TaskContext) -> dict[str, Any]:
        task_id = str(ctx.task_id)
        run_handle = ctx.begin_step("run-pi")
        if run_handle.done:
            return cast(dict[str, Any], run_handle.state)

        # Arbitrary agent side effects cannot be made transactional with Postgres. Persist an
        # intent before launching Pi so a recovered task stops for review instead of running the
        # same shell/edit operations twice after a host crash.
        intent = ctx.begin_step("run-intent")
        if intent.done:
            return {
                "state": "needs_manual_reconciliation",
                "session_id": task_id,
                "message": "Pi started previously but did not checkpoint a result; not rerun.",
            }
        ctx.complete_step(intent, {"started": True, "session_id": task_id})
        if artifacts:
            with artifacts.materialize_workspace(
                str(params["workspace"]), settings.worker_scratch_root
            ) as workspace:
                result = run_pi(
                    settings,
                    task_id=task_id,
                    instruction=str(params["instruction"]),
                    workspace=workspace,
                )
                result["artifacts"] = artifacts.capture_result(
                    task_id=task_id,
                    workspace=workspace,
                    execution=result,
                    max_bytes=settings.max_artifact_bytes,
                )
        else:
            workspace = ctx.step(
                "prepare-workspace",
                lambda: str(
                    resolve_workspace(str(params["workspace"]), settings.workspace_roots)
                ),
            )
            result = run_pi(
                settings,
                task_id=task_id,
                instruction=str(params["instruction"]),
                workspace=Path(workspace),
            )
        return ctx.complete_step(run_handle, result)

    return absurd


def main() -> None:
    load_dotenv(override=True)
    settings = Settings.from_env()
    worker = create_worker(settings)
    try:
        worker.start_worker(concurrency=1)
    finally:
        worker.close()


if __name__ == "__main__":
    main()
