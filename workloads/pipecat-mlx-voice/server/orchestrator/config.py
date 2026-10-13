"""Configuration shared by the API and worker."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _bool_env(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).lower() in {"1", "true", "yes"}


def _csv(name: str) -> tuple[str, ...]:
    return tuple(value.strip() for value in os.getenv(name, "").split(",") if value.strip())


def _value(name: str, default: str = "") -> str:
    value = os.getenv(name, default)
    file_name = os.getenv(f"{name}_FILE")
    if file_name:
        return Path(file_name).read_text(encoding="utf-8").strip()
    return value


@dataclass(frozen=True)
class Settings:
    database_url: str
    approval_secret: str
    allowed_users: tuple[str, ...]
    workspace_roots: tuple[Path, ...]
    allow_local_dev: bool
    approval_ttl_seconds: int
    queue: str
    pi_binary: str
    pi_model: str | None
    pi_thinking: str
    pi_session_dir: Path
    gondolin_extension: Path | None
    allow_unsandboxed: bool
    task_timeout_seconds: int
    max_output_bytes: int
    artifact_endpoint_url: str = ""
    artifact_bucket: str = ""
    artifact_access_key: str = ""
    artifact_secret_key: str = ""
    allowed_workspaces: tuple[str, ...] = ()
    worker_scratch_root: Path = Path("~/.local/share/agent-workload-platform/workspaces")
    max_artifact_bytes: int = 16_777_216
    defer_workspace_validation: bool = False

    @classmethod
    def from_env(cls) -> Settings:
        roots = _csv("ORCHESTRATOR_WORKSPACE_ROOTS")
        extension = _value("PI_GONDOLIN_EXTENSION")
        return cls(
            database_url=_value("DATABASE_URL"),
            approval_secret=_value("ORCHESTRATOR_APPROVAL_SECRET"),
            allowed_users=_csv("ORCHESTRATOR_ALLOWED_USERS"),
            workspace_roots=tuple(Path(root).expanduser().resolve() for root in roots),
            allow_local_dev=_bool_env("ORCHESTRATOR_ALLOW_LOCAL_DEV"),
            approval_ttl_seconds=int(os.getenv("ORCHESTRATOR_APPROVAL_TTL_SECONDS", "300")),
            queue=_value("ABSURD_QUEUE", "agents"),
            pi_binary=_value("PI_BINARY", "/opt/homebrew/bin/pi"),
            pi_model=_value("PI_MODEL") or None,
            pi_thinking=_value("PI_THINKING", "medium"),
            pi_session_dir=Path(_value("PI_SESSION_DIR", "~/.pi/agent/sessions")).expanduser(),
            gondolin_extension=Path(extension).expanduser().resolve() if extension else None,
            allow_unsandboxed=_bool_env("WORKER_ALLOW_UNSANDBOXED"),
            task_timeout_seconds=int(os.getenv("WORKER_TASK_TIMEOUT_SECONDS", "1800")),
            max_output_bytes=int(os.getenv("WORKER_MAX_OUTPUT_BYTES", "1048576")),
            artifact_endpoint_url=_value("ARTIFACT_ENDPOINT_URL"),
            artifact_bucket=_value("ARTIFACT_BUCKET", "agent-artifacts"),
            artifact_access_key=_value("ARTIFACT_ACCESS_KEY", "local-test"),
            artifact_secret_key=_value("ARTIFACT_SECRET_KEY", "local-test"),
            allowed_workspaces=_csv("ORCHESTRATOR_ALLOWED_WORKSPACES"),
            worker_scratch_root=Path(
                _value(
                    "WORKER_SCRATCH_ROOT",
                    "~/.local/share/agent-workload-platform/workspaces",
                )
            ).expanduser(),
            max_artifact_bytes=int(os.getenv("WORKER_MAX_ARTIFACT_BYTES", "16777216")),
            defer_workspace_validation=_bool_env("ORCHESTRATOR_DEFER_WORKSPACE_VALIDATION"),
        )

    @property
    def artifact_workspaces(self) -> bool:
        return bool(self.artifact_endpoint_url)

    def require_api(self) -> None:
        missing = []
        if not self.database_url:
            missing.append("DATABASE_URL")
        if len(self.approval_secret) < 32:
            missing.append("ORCHESTRATOR_APPROVAL_SECRET (at least 32 characters)")
        if self.artifact_workspaces:
            if not self.artifact_bucket:
                missing.append("ARTIFACT_BUCKET")
            if not self.artifact_access_key or not self.artifact_secret_key:
                missing.append("ARTIFACT_ACCESS_KEY/ARTIFACT_SECRET_KEY")
            if not self.allowed_workspaces:
                missing.append("ORCHESTRATOR_ALLOWED_WORKSPACES")
        elif not self.workspace_roots:
            missing.append("ORCHESTRATOR_WORKSPACE_ROOTS")
        if missing:
            raise RuntimeError("Missing secure orchestrator configuration: " + ", ".join(missing))
