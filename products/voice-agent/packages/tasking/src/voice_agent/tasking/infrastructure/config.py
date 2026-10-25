"""Environment-backed tasking configuration adapter."""

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
    approval_ttl_seconds: int
    pi_model: str | None
    pi_thinking: str
    pi_session_dir: Path
    pi_execution_mode: str
    max_output_bytes: int
    skills_dir: Path | None
    pi_durable_mcp_servers_file: Path | None = None
    artifact_endpoint_url: str = ""
    artifact_bucket: str = ""
    artifact_access_key: str = ""
    artifact_secret_key: str = ""
    allowed_workspaces: tuple[str, ...] = ()
    worker_scratch_root: Path = Path("~/.local/share/agent-workload-platform/workspaces")
    scratch_image_ref: str = ""
    max_artifact_bytes: int = 16_777_216
    defer_workspace_validation: bool = False
    image_build_timeout_seconds: int = 7200
    image_installer_cli: Path | None = None
    image_handoff_dir: Path | None = None
    gitea_endpoint_url: str = ""
    gitea_source_owner: str = "source-publisher"
    gitea_image_workflow: str = "build-execution-image.yml"
    gitea_workflow_ref: str = "refs/heads/main"
    gitea_actions_token: str = ""
    node_binary: str = "/opt/homebrew/bin/node"
    digital_twin_runner: Path | None = None
    digital_twin_timeout_seconds: int = 120
    music_generation_base_url: str = ""
    music_generation_timeout_seconds: int = 600
    music_ffmpeg_binary: str = "/opt/homebrew/bin/ffmpeg"
    pi_durable_owner_url: str = "http://host.docker.internal:9448"
    pi_durable_owner_token_file: Path = Path("/run/secrets/agent-gateway-token")

    @classmethod
    def from_env(cls) -> Settings:
        roots = _csv("ORCHESTRATOR_WORKSPACE_ROOTS")
        return cls(
            database_url=_value("DATABASE_URL"),
            approval_secret=_value("ORCHESTRATOR_APPROVAL_SECRET"),
            allowed_users=_csv("ORCHESTRATOR_ALLOWED_USERS"),
            workspace_roots=tuple(Path(root).expanduser().resolve() for root in roots),
            approval_ttl_seconds=int(os.getenv("ORCHESTRATOR_APPROVAL_TTL_SECONDS", "300")),
            pi_model=_value("PI_MODEL") or None,
            pi_thinking=_value("PI_THINKING", "medium"),
            pi_session_dir=Path(_value("PI_SESSION_DIR", "~/.pi/agent/sessions")).expanduser(),
            pi_execution_mode=_value("WORKER_PI_EXECUTION_MODE", "gondolin").lower(),
            max_output_bytes=int(os.getenv("WORKER_MAX_OUTPUT_BYTES", "1048576")),
            skills_dir=(
                Path(_value("PI_TASK_SKILLS_DIR")).expanduser().resolve()
                if _value("PI_TASK_SKILLS_DIR")
                else None
            ),
            pi_durable_mcp_servers_file=(
                Path(_value("PI_DURABLE_MCP_SERVERS_FILE")).expanduser()
                if _value("PI_DURABLE_MCP_SERVERS_FILE")
                else None
            ),
            pi_durable_owner_url=_value("PI_DURABLE_OWNER_URL", "http://host.docker.internal:9448"),
            pi_durable_owner_token_file=Path(
                _value("PI_DURABLE_OWNER_TOKEN_FILE", "/run/secrets/agent-gateway-token")
            ),
            artifact_endpoint_url=_value("ARTIFACT_ENDPOINT_URL"),
            artifact_bucket=_value("ARTIFACT_BUCKET", "agent-artifacts"),
            artifact_access_key=_value("ARTIFACT_ACCESS_KEY", "local-test"),
            artifact_secret_key=_value("ARTIFACT_SECRET_KEY", "local-test"),
            allowed_workspaces=_csv("ORCHESTRATOR_ALLOWED_WORKSPACES"),
            worker_scratch_root=Path(
                _value(
                    "WORKER_SCRATCH_ROOT",
                    "/tmp/agent-workload-platform/workspaces",
                )
            ).expanduser(),
            scratch_image_ref=_value("WORKER_SCRATCH_IMAGE_REF") or _value("GONDOLIN_BROWSER_ASSETS"),
            max_artifact_bytes=int(os.getenv("WORKER_MAX_ARTIFACT_BYTES", "16777216")),
            defer_workspace_validation=_bool_env("ORCHESTRATOR_DEFER_WORKSPACE_VALIDATION"),
            image_build_timeout_seconds=int(os.getenv("IMAGE_BUILD_TIMEOUT_SECONDS", "7200")),
            image_installer_cli=(
                Path(_value("IMAGE_INSTALLER_CLI")).expanduser().resolve()
                if _value("IMAGE_INSTALLER_CLI")
                else None
            ),
            image_handoff_dir=(
                Path(_value("GONDOLIN_IMAGE_HANDOFF_DIR")).expanduser().resolve()
                if _value("GONDOLIN_IMAGE_HANDOFF_DIR")
                else None
            ),
            gitea_endpoint_url=_value("GITEA_ENDPOINT_URL", "http://127.0.0.1:3001"),
            gitea_source_owner=_value("GITEA_OWNER", "source-publisher"),
            gitea_image_workflow=_value(
                "GITEA_IMAGE_WORKFLOW", "build-execution-image.yml"
            ),
            gitea_workflow_ref=_value("GITEA_WORKFLOW_REF", "refs/heads/main"),
            gitea_actions_token=_value("GITEA_ACTIONS_TOKEN"),
            node_binary=_value("NODE_BINARY", "/opt/homebrew/bin/node"),
            digital_twin_runner=(
                Path(_value("DIGITAL_TWIN_RUNNER")).expanduser().resolve()
                if _value("DIGITAL_TWIN_RUNNER")
                else None
            ),
            digital_twin_timeout_seconds=int(
                os.getenv("DIGITAL_TWIN_TIMEOUT_SECONDS", "120")
            ),
            music_generation_base_url=_value("MUSIC_GENERATION_BASE_URL"),
            music_generation_timeout_seconds=int(
                os.getenv("MUSIC_GENERATION_TIMEOUT_SECONDS", "600")
            ),
            music_ffmpeg_binary=_value(
                "MUSIC_FFMPEG_BINARY", "/opt/homebrew/bin/ffmpeg"
            ),
        )

    @property
    def artifact_workspaces(self) -> bool:
        return bool(self.artifact_endpoint_url)

    @property
    def execution_image_handoff_dir(self) -> Path:
        if self.image_handoff_dir is not None:
            return self.image_handoff_dir
        if self.image_installer_cli is None:
            raise RuntimeError("IMAGE_INSTALLER_CLI is required for execution image handoff")
        return self.image_installer_cli.parents[3] / "gondolin-image-handoff"

    @property
    def music_generation_enabled(self) -> bool:
        return bool(self.music_generation_base_url)

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
        if missing:
            raise RuntimeError("Missing secure orchestrator configuration: " + ", ".join(missing))
