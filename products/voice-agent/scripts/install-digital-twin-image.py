#!/usr/bin/env python3
"""Build the digital-twin guest through Gitea Actions and install its verified image."""

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
from voice_agent.tasking.infrastructure.image_packages import GiteaImagePackages

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
    builder_token = required_file(secrets_dir / "gitea-builder-token")
    packages = GiteaImagePackages(endpoint, "image-builder", builder_token)
    manifest = packages.try_manifest(package="execution-images", version=plan.artifact_version)
    if manifest is None:
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
        manifest = packages.try_manifest(package="execution-images", version=plan.artifact_version)
    if manifest is None:
        raise RuntimeError("Gitea workflow completed without an image manifest")

    digest = manifest.get("digest")
    image_ref = manifest.get("imageRef")
    repository_path = manifest.get("registryRepository")
    if (
        not isinstance(digest, str)
        or not digest.startswith("sha256:")
        or image_ref != plan.image_ref
        or repository_path != "image-builder/execution-images"
    ):
        raise RuntimeError("Gitea image manifest does not match the requested digital twin image")
    installer = repository / "platform/agent-execution/gondolin-session/dist/image-builder/installer.js"
    if not installer.is_file():
        raise RuntimeError("build @agent-workload-platform/gondolin-session before installing the image")
    environment = {**os.environ, "GITEA_BUILDER_TOKEN": builder_token}
    completed = subprocess.run(
        [
            os.getenv("NODE_BINARY", "/opt/homebrew/bin/node"),
            str(installer),
            str(repository / plan.asset_config),
            f"127.0.0.1:3001/{repository_path}@{digest}",
            plan.image_ref,
            digest,
        ],
        check=True,
        text=True,
        capture_output=True,
        env=environment,
    )
    installed = json.loads(completed.stdout)
    print(
        json.dumps(
            {
                "artifactVersion": plan.artifact_version,
                "digest": digest,
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
