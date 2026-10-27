"""One product operation invoked by the long-lived Pi Durable owner."""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from typing import Any

from voice_agent.tasking.infrastructure.artifacts import ArtifactStore
from voice_agent.tasking.infrastructure.config import Settings

from .main import (
    create_song_renderer,
    create_song_writer,
    record_journal_decision,
    run_digital_twin,
    run_song_render,
    validate_worker,
)


def execute(kind: str, params: dict[str, Any], request_id: str, settings: Settings) -> dict[str, Any]:
    """Run effects under a stable native task ID so resumed Pi work is idempotent."""
    if kind not in {
        "song-render", "digital-twin-journal", "digital-twin-classify", "digital-twin-daily-journal"
    }:
        raise ValueError(f"unsupported product task: {kind}")
    validate_worker(settings)
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
    if kind in {"digital-twin-journal", "digital-twin-classify", "digital-twin-daily-journal"}:
        digital_twin_params = (
            {**params, "taskId": request_id}
            if kind == "digital-twin-daily-journal"
            else params
        )
        result = run_digital_twin(settings, digital_twin_params)
        record_journal_decision(result)
        return result
    if kind == "song-render":
        return run_song_render(
            create_song_renderer(settings), create_song_writer(artifacts),
            generation_id=str(params["generation_id"]), manifest_payload=params.get("manifest"),
        )

    raise ValueError(f"unsupported product task: {kind}")


def main() -> None:
    os.umask(0o077)
    owner_pid = int(os.getenv("PI_DURABLE_OWNER_PID", "0"))
    if owner_pid:
        def stop_if_owner_exits() -> None:
            while True:
                time.sleep(1)
                try:
                    os.kill(owner_pid, 0)
                except ProcessLookupError:
                    os._exit(1)

        threading.Thread(target=stop_if_owner_exits, daemon=True).start()
    payload = json.load(sys.stdin)
    result = execute(
        str(payload["kind"]), payload["params"], str(payload["requestId"]),
        Settings.from_env(),
    )
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
