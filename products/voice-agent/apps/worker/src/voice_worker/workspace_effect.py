"""Workspace and result effects for sessions owned by the Pi Durable process.

This module never starts Pi. Its task directory survives owner restart so a native
conversation can resume against the same workspace and repeat artifact publication.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from voice_agent.tasking.application.pi_response import presentation_prompt, response_from_text
from voice_agent.tasking.domain.song_generation import lyric_prompt, manifest_from_pi_result
from voice_agent.tasking.domain.workspaces import is_scratch_workspace, resolve_workspace
from voice_agent.tasking.infrastructure.artifacts import ArtifactStore
from voice_agent.tasking.infrastructure.config import Settings

from .main import prepare_repository_image, validate_worker

_TASK_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_REPOSITORY_SOURCE = re.compile(
    r"workspaces/([a-z0-9][a-z0-9._-]{0,127})/sources/[0-9a-f]{64}\.bundle"
)


def task_repository(workspace_ref: str) -> str | None:
    if is_scratch_workspace(workspace_ref):
        return None
    if workspace_ref.startswith("s3://"):
        match = _REPOSITORY_SOURCE.fullmatch(urlparse(workspace_ref).path.lstrip("/"))
        if not match:
            raise ValueError("workspace source does not identify a repository")
        return match.group(1)
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,127}", workspace_ref):
        raise ValueError("workspace does not identify a repository")
    return workspace_ref


def _artifacts(settings: Settings) -> ArtifactStore | None:
    if not settings.artifact_workspaces:
        return None
    return ArtifactStore(
        endpoint_url=settings.artifact_endpoint_url,
        bucket=settings.artifact_bucket,
        access_key=settings.artifact_access_key,
        secret_key=settings.artifact_secret_key,
    )


def prepare(payload: dict[str, Any], settings: Settings) -> dict[str, Any]:
    validate_worker(settings)
    kind = str(payload["kind"])
    if kind not in {"agent-run", "song-lyrics"}:
        raise ValueError("workspace effect only accepts Pi session tasks")
    task_id = str(payload["requestId"])
    if not _TASK_ID.fullmatch(task_id):
        raise ValueError("task ID must be a lowercase UUID")
    params = payload["params"]
    workspace_ref = str(params["workspace"])
    task_root = settings.worker_scratch_root / f"task-{task_id}"
    task_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if is_scratch_workspace(workspace_ref):
        workspace = task_root / "workspace"
        workspace.mkdir(parents=True, exist_ok=True, mode=0o700)
        image_ref = settings.scratch_image_ref or None
    else:
        artifacts = _artifacts(settings)
        if artifacts:
            with artifacts.materialize_workspace(
                workspace_ref, settings.worker_scratch_root, persistent_root=task_root
            ) as workspace:
                image_ref = prepare_repository_image(
                    settings, workspace=workspace, workspace_reference=workspace_ref
                )
        else:
            workspace = resolve_workspace(workspace_ref, settings.workspace_roots)
            image_ref = prepare_repository_image(
                settings, workspace=workspace, workspace_reference=workspace_ref
            )
    instruction = (
        str(params["instruction"])
        if kind == "agent-run" else lyric_prompt(
            brief=str(params["brief"]), style=str(params["style"]),
            duration_seconds=int(params["duration_seconds"]),
        )
    )
    return {
        "workspace": str(workspace),
        "imageRef": image_ref,
        "giteaRepository": task_repository(workspace_ref),
        "instruction": presentation_prompt(instruction),
    }


def finish(payload: dict[str, Any], settings: Settings) -> dict[str, Any]:
    kind = str(payload["kind"])
    if kind not in {"agent-run", "song-lyrics"}:
        raise ValueError("workspace effect only accepts Pi session tasks")
    if not _TASK_ID.fullmatch(str(payload["requestId"])):
        raise ValueError("task ID must be a lowercase UUID")
    text = str(payload["text"])
    response = response_from_text(text)
    result: dict[str, Any] = {
        "exit_code": 0,
        "response": {
            "text": response.text,
            "spoken": response.spoken,
            "presentation": response.presentation,
            "resourceUri": response.resource_uri,
        },
    }
    if kind == "song-lyrics":
        result["manifest"] = manifest_from_pi_result(result).to_dict()
    else:
        artifacts = _artifacts(settings)
        if artifacts:
            workspace = Path(str(payload["workspace"]))
            workspace_ref = str(payload["params"]["workspace"])
            capture = (artifacts.capture_scratch_result if is_scratch_workspace(workspace_ref)
                       else artifacts.capture_result)
            result["artifacts"] = capture(
                task_id=str(payload["requestId"]), workspace=workspace,
                execution=result, max_bytes=settings.max_artifact_bytes,
            )
    return result


def main() -> None:
    os.umask(0o077)
    payload = json.load(sys.stdin)
    settings = Settings.from_env()
    action = payload.get("action")
    if action == "prepare":
        result = prepare(payload, settings)
    elif action == "finish":
        result = finish(payload, settings)
    else:
        raise ValueError("invalid workspace effect action")
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
