#!/usr/bin/env python3
"""Build the digital-twin guest through Gitea Actions and install its local handoff."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

from voice_agent.tasking.domain.execution_images import (
    load_execution_image_plan,
)
from voice_agent.tasking.infrastructure.gitea_actions import GiteaActions

CONFIG_PATH = Path(
    "products/voice-agent/apps/pi-agent/digital-twin/runtime/image/gondolin.json"
)


def required_file(path: Path) -> str:
    value = path.read_text(encoding="utf-8").strip()
    if not value:
        raise RuntimeError(f"required credential is empty: {path}")
    return value


def main() -> None:
    product = Path(__file__).resolve().parents[1]
    repository = product.parents[1]
    revision = os.getenv("DIGITAL_TWIN_SOURCE_REVISION") or subprocess.check_output(
        ["git", "-C", str(repository), "rev-parse", "HEAD"], text=True
    ).strip()
    plan = load_execution_image_plan(
        repository,
        source_revision=revision,
        config_path=CONFIG_PATH,
    )
    if plan is None:
        raise RuntimeError("digital twin image declaration is missing")

    endpoint = os.getenv("GITEA_ENDPOINT_URL", "http://127.0.0.1:3001").rstrip("/")
    owner = os.getenv("GITEA_OWNER", "source-publisher")
    repository_name = repository.name
    secrets_dir = product / "deploy" / "secrets"
    dispatcher_token = required_file(secrets_dir / "gitea-dispatcher-token")
    installer = repository / "platform/agent-execution/gondolin-session/dist/image-builder/installer.js"
    if not installer.is_file():
        raise RuntimeError("build @agent-workload-platform/gondolin-session before installing the image")
    node = os.getenv("NODE_BINARY", "/opt/homebrew/bin/node")
    inspected = subprocess.run(
        [node, str(installer), "inspect", str(repository / plan.asset_config), plan.image_ref],
        check=True,
        capture_output=True,
        text=True,
    )
    if json.loads(inspected.stdout).get("present") is True:
        print(json.dumps({"artifactVersion": plan.artifact_version, "imageRef": plan.image_ref, "cached": True}))
        return
    archive_dir = Path(os.getenv(
        "GONDOLIN_IMAGE_HANDOFF_DIR",
        str(installer.parents[3] / "gondolin-image-handoff"),
    )).expanduser()
    archive = archive_dir / f"{plan.artifact_version}.tar"
    if not archive.exists():
        actions = GiteaActions(endpoint, owner, dispatcher_token)
        run = actions.dispatch(
            repository=repository_name,
            workflow=os.getenv("GITEA_IMAGE_WORKFLOW", "build-execution-image.yml"),
            ref=os.getenv("GITEA_WORKFLOW_REF", "refs/heads/main"),
            inputs={
                "artifact_version": plan.artifact_version,
                "source_revision": revision,
                "image_config": plan.config_path.as_posix(),
            },
        )
        deadline = time.monotonic() + int(os.getenv("IMAGE_BUILD_TIMEOUT_SECONDS", "7200"))
        while not run.terminal:
            if time.monotonic() >= deadline:
                actions.cancel(repository=repository_name, run_id=run.id)
                raise RuntimeError(f"digital twin image workflow {run.id} timed out")
            time.sleep(5)
            run = actions.get(repository=repository_name, run_id=run.id)
        if run.conclusion != "success":
            raise RuntimeError(
                f"digital twin image workflow {run.id} concluded {run.conclusion or 'without a result'}"
            )
    if archive.is_symlink() or not archive.is_file():
        raise RuntimeError("Gitea workflow completed without a regular local image handoff")
    completed = subprocess.run(
        [
            node,
            str(installer),
            "local-install",
            str(repository / plan.asset_config),
            str(archive),
            plan.image_ref,
            plan.artifact_version,
        ],
        check=True,
        text=True,
        capture_output=True,
    )
    installed = json.loads(completed.stdout)
    print(
        json.dumps(
            {
                "artifactVersion": plan.artifact_version,
                "imageRef": plan.image_ref,
                "installed": installed,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from error
