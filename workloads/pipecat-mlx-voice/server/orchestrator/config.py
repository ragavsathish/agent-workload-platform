"""Configuration shared by the API and worker."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _bool_env(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).lower() in {"1", "true", "yes"}


def _csv(name: str) -> tuple[str, ...]:
    return tuple(value.strip() for value in os.getenv(name, "").split(",") if value.strip())


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

    @classmethod
    def from_env(cls) -> Settings:
        roots = _csv("ORCHESTRATOR_WORKSPACE_ROOTS")
        extension = os.getenv("PI_GONDOLIN_EXTENSION")
        return cls(
            database_url=os.getenv("DATABASE_URL", ""),
            approval_secret=os.getenv("ORCHESTRATOR_APPROVAL_SECRET", ""),
            allowed_users=_csv("ORCHESTRATOR_ALLOWED_USERS"),
            workspace_roots=tuple(Path(root).expanduser().resolve() for root in roots),
            allow_local_dev=_bool_env("ORCHESTRATOR_ALLOW_LOCAL_DEV"),
            approval_ttl_seconds=int(os.getenv("ORCHESTRATOR_APPROVAL_TTL_SECONDS", "300")),
            queue=os.getenv("ABSURD_QUEUE", "agents"),
            pi_binary=os.getenv("PI_BINARY", "/opt/homebrew/bin/pi"),
            pi_model=os.getenv("PI_MODEL") or None,
            pi_thinking=os.getenv("PI_THINKING", "medium"),
            pi_session_dir=Path(os.getenv("PI_SESSION_DIR", "~/.pi/agent/sessions")).expanduser(),
            gondolin_extension=Path(extension).expanduser().resolve() if extension else None,
            allow_unsandboxed=_bool_env("WORKER_ALLOW_UNSANDBOXED"),
            task_timeout_seconds=int(os.getenv("WORKER_TASK_TIMEOUT_SECONDS", "1800")),
            max_output_bytes=int(os.getenv("WORKER_MAX_OUTPUT_BYTES", "1048576")),
        )

    def require_api(self) -> None:
        missing = []
        if not self.database_url:
            missing.append("DATABASE_URL")
        if len(self.approval_secret) < 32:
            missing.append("ORCHESTRATOR_APPROVAL_SECRET (at least 32 characters)")
        if not self.workspace_roots:
            missing.append("ORCHESTRATOR_WORKSPACE_ROOTS")
        if missing:
            raise RuntimeError("Missing secure orchestrator configuration: " + ", ".join(missing))
