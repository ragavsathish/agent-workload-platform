"""Run the local Agent Task Pi RPC path without installing deployed services."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import uuid
from dataclasses import replace
from pathlib import Path

from opentelemetry import metrics, trace
from voice_agent.tasking.infrastructure.config import Settings

from voice_worker.main import run_pi

SMOKE_INSTRUCTION = (
    "Reply briefly that the native Rust RPC integration is healthy. Do not call tools."
)
MAX_SPOKEN_CHARS = 500


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Exercise the local worker, Rust RPC host, Pi, and Gondolin path."
    )
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    arguments = parse_args()
    artifact = arguments.artifact.expanduser().resolve()
    workspace = arguments.workspace.expanduser().resolve()
    if not artifact.is_file() or not os.access(artifact, os.X_OK):
        raise SystemExit(f"Pi RPC artifact is not executable: {artifact}")
    if not workspace.is_dir():
        raise SystemExit(f"Workspace is not a directory: {workspace}")

    with tempfile.TemporaryDirectory(prefix="pi-rpc-smoke-", dir="/tmp") as temporary:
        root = Path(temporary)
        settings = replace(
            Settings.from_env(),
            pi_rpc_host_binary=artifact,
            pi_session_dir=root / "sessions",
            pi_rpc_socket_dir=root / "sockets",
            pi_rpc_idle_seconds=0.2,
            task_timeout_seconds=180,
        )
        result = run_pi(
            settings,
            task_id=str(uuid.uuid4()),
            instruction=SMOKE_INSTRUCTION,
            workspace=workspace,
        )

    for provider in (trace.get_tracer_provider(), metrics.get_meter_provider()):
        force_flush = getattr(provider, "force_flush", None)
        if callable(force_flush):
            force_flush()

    response = result["response"]
    presentation = response.get("presentation")
    presentation_kind = presentation.get("kind") if isinstance(presentation, dict) else None
    spoken = response.get("spoken")
    print(
        json.dumps(
            {
                "status": "ok",
                "spoken": str(spoken or "")[:MAX_SPOKEN_CHARS],
                "presentationKind": str(presentation_kind or "")[:64],
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
