"""Validated, deterministic contract for project-specific execution images."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class ExecutionImageConfigurationError(ValueError):
    """The repository's trusted image-build declaration is invalid."""


@dataclass(frozen=True)
class ExecutionImagePlan:
    image_ref: str
    context: Path
    dockerfile: Path
    asset_config: Path
    target: str | None
    named_contexts: tuple[tuple[str, Path], ...]
    source_revision: str
    artifact_version: str

    @property
    def idempotency_key(self) -> str:
        return f"image-build:{self.artifact_version}"


def _relative_path(workspace: Path, value: object, field: str) -> Path:
    if not isinstance(value, str) or not value:
        raise ExecutionImageConfigurationError(f"build.{field} must be a non-empty path")
    relative = Path(value)
    if relative.is_absolute():
        raise ExecutionImageConfigurationError(f"build.{field} must be relative")
    resolved = (workspace / relative).resolve()
    try:
        resolved.relative_to(workspace.resolve())
    except ValueError as error:
        raise ExecutionImageConfigurationError(
            f"build.{field} must remain inside the workspace"
        ) from error
    return relative


def _read_config(workspace: Path) -> dict[str, Any] | None:
    path = workspace / ".pi" / "gondolin.json"
    if not path.is_file():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ExecutionImageConfigurationError(f"invalid {path}: {error}") from error
    if not isinstance(value, dict):
        raise ExecutionImageConfigurationError(".pi/gondolin.json must contain an object")
    return value


def _git_object_id(workspace: Path, source_revision: str, path: Path) -> str:
    """Identify one immutable build input without coupling it to the whole commit."""

    revision_path = (
        f"{source_revision}^{{tree}}"
        if path == Path(".")
        else f"{source_revision}:{path.as_posix()}"
    )
    try:
        return subprocess.check_output(
            ["git", "-C", str(workspace), "rev-parse", revision_path],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except subprocess.CalledProcessError as error:
        raise ExecutionImageConfigurationError(
            f"build input is not present in source revision: {path}"
        ) from error


def load_execution_image_plan(
    workspace: Path, *, source_revision: str
) -> ExecutionImagePlan | None:
    """Return a build plan without granting the repository arbitrary host paths."""

    config = _read_config(workspace)
    if config is None or "image" not in config:
        return None
    image_ref = config["image"]
    if not isinstance(image_ref, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}", image_ref):
        raise ExecutionImageConfigurationError("image must be a valid non-empty image reference")
    build = config.get("build")
    if not isinstance(build, dict):
        raise ExecutionImageConfigurationError("project image requires a build object")

    context = _relative_path(workspace, build.get("context"), "context")
    dockerfile = _relative_path(workspace, build.get("dockerfile"), "dockerfile")
    asset_config = _relative_path(workspace, build.get("assetConfig"), "assetConfig")
    if not (workspace / context).is_dir():
        raise ExecutionImageConfigurationError("build.context directory does not exist")
    if not (workspace / dockerfile).is_file():
        raise ExecutionImageConfigurationError("build.dockerfile file does not exist")
    if not (workspace / asset_config).is_file():
        raise ExecutionImageConfigurationError("build.assetConfig file does not exist")

    target = build.get("target")
    if target is not None and (
        not isinstance(target, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", target)
    ):
        raise ExecutionImageConfigurationError("build.target is invalid")
    raw_contexts = build.get("contexts", {})
    if not isinstance(raw_contexts, dict):
        raise ExecutionImageConfigurationError("build.contexts must be an object")
    named_contexts: list[tuple[str, Path]] = []
    for name, value in sorted(raw_contexts.items()):
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}", name):
            raise ExecutionImageConfigurationError("build.contexts contains an invalid name")
        relative = _relative_path(workspace, value, f"contexts.{name}")
        if not (workspace / relative).exists():
            raise ExecutionImageConfigurationError(f"build.contexts.{name} does not exist")
        named_contexts.append((name, relative))

    normalized = json.dumps(build, sort_keys=True, separators=(",", ":"))
    inputs = {
        "context": _git_object_id(workspace, source_revision, context),
        "dockerfile": _git_object_id(workspace, source_revision, dockerfile),
        "assetConfig": _git_object_id(workspace, source_revision, asset_config),
        "contexts": {
            name: _git_object_id(workspace, source_revision, relative)
            for name, relative in named_contexts
        },
    }
    cache_contract = json.dumps(
        {"image": image_ref, "build": normalized, "inputs": inputs},
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(cache_contract.encode()).hexdigest()[:32]
    return ExecutionImagePlan(
        image_ref=image_ref,
        context=context,
        dockerfile=dockerfile,
        asset_config=asset_config,
        target=target,
        named_contexts=tuple(named_contexts),
        source_revision=source_revision,
        artifact_version=f"v2-{digest}",
    )
