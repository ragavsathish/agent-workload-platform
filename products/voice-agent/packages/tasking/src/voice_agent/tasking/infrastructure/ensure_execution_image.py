"""Resolve a repository-declared Gondolin image before a durable Pi session starts."""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse

from voice_agent.tasking.domain.execution_images import load_execution_image_plan
from voice_agent.tasking.infrastructure.config import Settings
from voice_agent.tasking.infrastructure.gitea_actions import GiteaActions
from voice_agent.tasking.infrastructure.image_packages import GiteaImagePackages


def _git(workspace: Path, *args: str) -> str:
    return subprocess.check_output(
        ["git", "-C", str(workspace), *args], text=True, stderr=subprocess.DEVNULL
    ).strip()


def _repository_name(workspace: Path, workspace_reference: str) -> str:
    if workspace_reference.startswith("s3://"):
        match = re.fullmatch(
            r"workspaces/([a-z0-9][a-z0-9._-]*)/sources/[a-f0-9]{64}\.bundle",
            urlparse(workspace_reference).path.lstrip("/"),
        )
        if match:
            return match.group(1)
    remote = _git(workspace, "config", "--get", "remote.origin.url")
    match = re.search(r"([^/:]+?)(?:\.git)?$", remote)
    if not match:
        raise RuntimeError("repository image build requires an origin remote")
    return match.group(1)


def ensure_execution_image(
    settings: Settings, *, workspace: Path, workspace_reference: str
) -> str | None:
    """Build on a package miss, verify the artifact, then install its Gondolin ref."""

    if not (workspace / ".pi/gondolin.json").is_file():
        return None
    revision = _git(workspace, "rev-parse", "HEAD")
    plan = load_execution_image_plan(workspace, source_revision=revision)
    if plan is None:
        return None
    if not settings.image_installer_cli or not settings.image_installer_cli.is_file():
        raise RuntimeError("IMAGE_INSTALLER_CLI is required for repository-declared images")
    if not settings.gitea_builder_token:
        raise RuntimeError("Gitea builder token is required for repository images")

    repository = _repository_name(workspace, workspace_reference)
    packages = GiteaImagePackages(
        settings.gitea_endpoint_url, settings.gitea_package_owner, settings.gitea_builder_token
    )
    manifest = packages.try_manifest(package="execution-images", version=plan.artifact_version)
    if manifest is None:
        if not settings.gitea_actions_token:
            raise RuntimeError("Gitea dispatcher token is required to build a missing image")
        actions = GiteaActions(
            settings.gitea_endpoint_url, settings.gitea_source_owner, settings.gitea_actions_token
        )
        run = actions.dispatch(
            repository=repository,
            workflow=settings.gitea_image_workflow,
            ref=settings.gitea_workflow_ref,
            inputs={
                "artifact_version": plan.artifact_version,
                "source_revision": revision,
                "image_config": plan.config_path.as_posix(),
            },
        )
        deadline = time.monotonic() + settings.image_build_timeout_seconds
        while not run.terminal:
            if time.monotonic() >= deadline:
                actions.cancel(repository=repository, run_id=run.id)
                raise RuntimeError(f"execution image workflow {run.id} timed out")
            time.sleep(5)
            run = actions.get(repository=repository, run_id=run.id)
        if run.conclusion != "success":
            raise RuntimeError(
                f"execution image workflow {run.id} concluded "
                f"{run.conclusion or 'without a result'}"
            )
        manifest = packages.try_manifest(package="execution-images", version=plan.artifact_version)

    if manifest is None:
        raise RuntimeError("execution image workflow completed without a manifest")
    digest = manifest.get("digest")
    if (
        not isinstance(digest, str)
        or re.fullmatch(r"sha256:[a-f0-9]{64}", digest) is None
        or manifest.get("artifactVersion") != plan.artifact_version
        or manifest.get("imageRef") != plan.image_ref
        or manifest.get("registryRepository") != "image-builder/execution-images"
    ):
        raise RuntimeError("execution image manifest does not match the repository declaration")
    registry = urlparse(settings.gitea_endpoint_url)
    if registry.scheme != "http" or registry.hostname not in {"127.0.0.1", "localhost"}:
        raise RuntimeError("image installer requires a loopback Gitea endpoint")
    registry_image = f"{registry.netloc}/image-builder/execution-images@{digest}"
    completed = subprocess.run(
        [
            settings.node_binary,
            str(settings.image_installer_cli),
            str(workspace / plan.asset_config),
            registry_image,
            plan.image_ref,
            digest,
        ],
        check=True,
        capture_output=True,
        text=True,
        env={**os.environ, "GITEA_BUILDER_TOKEN": settings.gitea_builder_token},
    )
    installed = json.loads(completed.stdout)
    if installed.get("reference") != plan.image_ref:
        raise RuntimeError("installed Gondolin image reference did not match the plan")
    return plan.image_ref
