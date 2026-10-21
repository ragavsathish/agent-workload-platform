"""Resolve a repository-declared Gondolin image before a durable Pi session starts."""

from __future__ import annotations

import json
import re
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse

from voice_agent.tasking.domain.execution_images import load_execution_image_plan
from voice_agent.tasking.infrastructure.config import Settings
from voice_agent.tasking.infrastructure.gitea_actions import GiteaActions


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


def _workflow_ref(workspace: Path) -> str:
    """Use the snapshot's branch for the workflow definition and source checkout."""

    try:
        branch_ref = _git(workspace, "symbolic-ref", "--quiet", "HEAD")
    except subprocess.CalledProcessError as error:
        raise RuntimeError(
            "repository image build requires a named source branch; "
            "publish a branch-bearing workspace snapshot"
        ) from error
    if not branch_ref.startswith("refs/heads/"):
        raise RuntimeError("repository image build requires a local source branch")
    return branch_ref


def ensure_execution_image(
    settings: Settings, *, workspace: Path, workspace_reference: str
) -> str | None:
    """Build on a local cache miss, then import the image into Gondolin."""

    if not (workspace / ".pi/gondolin.json").is_file():
        return None
    revision = _git(workspace, "rev-parse", "HEAD")
    plan = load_execution_image_plan(workspace, source_revision=revision)
    if plan is None:
        return None
    if not settings.image_installer_cli or not settings.image_installer_cli.is_file():
        raise RuntimeError("IMAGE_INSTALLER_CLI is required for repository-declared images")
    inspected = subprocess.run(
        [
            settings.node_binary,
            str(settings.image_installer_cli),
            "inspect",
            str(workspace / plan.asset_config),
            plan.installed_image_ref,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    if json.loads(inspected.stdout).get("present") is True:
        return plan.installed_image_ref
    archive = settings.execution_image_handoff_dir / f"{plan.artifact_version}.tar"
    if not archive.exists():
        if not settings.gitea_actions_token:
            raise RuntimeError("Gitea dispatcher token is required to build a missing image")
        repository = _repository_name(workspace, workspace_reference)
        actions = GiteaActions(
            settings.gitea_endpoint_url, settings.gitea_source_owner, settings.gitea_actions_token
        )
        run = actions.dispatch(
            repository=repository,
            workflow=settings.gitea_image_workflow,
            ref=_workflow_ref(workspace),
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
    if archive.is_symlink() or not archive.is_file():
        raise RuntimeError("execution image workflow did not produce a regular local archive")
    completed = subprocess.run(
        [
            settings.node_binary,
            str(settings.image_installer_cli),
            "local-install",
            str(workspace / plan.asset_config),
            str(archive),
            plan.installed_image_ref,
            plan.artifact_version,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    installed = json.loads(completed.stdout)
    if installed.get("reference") != plan.installed_image_ref:
        raise RuntimeError("installed Gondolin image reference did not match the plan")
    return plan.installed_image_ref
