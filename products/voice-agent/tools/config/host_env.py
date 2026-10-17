"""Project the private environment into least-privilege native service files."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

from dotenv import dotenv_values

BROKER_KEYS = (
    "INFERENCE_BROKER_TOKEN",
    "BROKER_MAX_AUDIO_BYTES",
    "BROKER_MAX_AUDIO_SECONDS",
    "BROKER_MAX_CHAT_BYTES",
    "BROKER_MAX_TTS_CHARS",
    "OLLAMA_MODEL",
    "OLLAMA_BASE_URL",
    "MLX_STT_MODEL",
    "MLX_TTS_MODEL",
    "MLX_TTS_VOICE",
    "MLX_TTS_SPEED",
    "MLX_TTS_LANGUAGE_CODE",
    "MLX_TTS_STREAMING_INTERVAL",
    "AGENT_GATEWAY_TOKEN",
    "ORCHESTRATOR_ALLOWED_USERS",
    "ARTIFACT_ENDPOINT_URL",
    "ARTIFACT_BUCKET",
    "ARTIFACT_ACCESS_KEY",
    "ARTIFACT_SECRET_KEY",
    "GITEA_ENDPOINT_URL",
    "GITEA_OWNER",
    "PI_BINARY",
    "PI_MODEL",
    "PI_VOICE_MODEL",
    "PI_VOICE_THINKING",
    "PI_VOICE_TIMEOUT_SECONDS",
)

WORKER_KEYS = (
    "DATABASE_URL",
    "ABSURD_QUEUE",
    "IMAGE_BUILD_TIMEOUT_SECONDS",
    "NODE_BINARY",
    "ORCHESTRATOR_APPROVAL_SECRET",
    "ORCHESTRATOR_APPROVAL_TTL_SECONDS",
    "ORCHESTRATOR_ALLOWED_USERS",
    "ORCHESTRATOR_WORKSPACE_ROOTS",
    "ORCHESTRATOR_ALLOWED_WORKSPACES",
    "ARTIFACT_ENDPOINT_URL",
    "ARTIFACT_BUCKET",
    "ARTIFACT_ACCESS_KEY",
    "ARTIFACT_SECRET_KEY",
    "GITEA_ENDPOINT_URL",
    "GITEA_OWNER",
    "GITEA_IMAGE_WORKFLOW",
    "GITEA_WORKFLOW_REF",
    "WORKER_SCRATCH_ROOT",
    "WORKER_MAX_ARTIFACT_BYTES",
    "PI_BINARY",
    "PI_MODEL",
    "PI_THINKING",
    "PI_SESSION_DIR",
    "WORKER_ALLOW_UNSANDBOXED",
    "WORKER_TASK_TIMEOUT_SECONDS",
    "WORKER_MAX_OUTPUT_BYTES",
    "DIGITAL_TWIN_CLASSIFIER_BASE_URL",
    "DIGITAL_TWIN_CLASSIFIER_MODEL",
    "DIGITAL_TWIN_REVIEW_THRESHOLD",
)


def required(values: dict[str, str | None], name: str) -> str:
    value = values.get(name)
    if not value:
        raise SystemExit(f"{name} must be configured in deploy/.env")
    return value


def secret(root: Path, name: str) -> str:
    path = root / "deploy/secrets" / name
    if not path.is_file() or not (value := path.read_text(encoding="utf-8").strip()):
        raise SystemExit(f"Missing deployment secret: deploy/secrets/{name}")
    return value


def selected(values: dict[str, str | None], keys: tuple[str, ...]) -> dict[str, str]:
    return {key: value for key in keys if (value := values.get(key)) is not None}


def render(values: dict[str, str]) -> str:
    def quote(value: str) -> str:
        escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        return f'"{escaped}"'

    return "".join(f"{key}={quote(value)}\n" for key, value in values.items())


def write_environment(path: Path, values: dict[str, str]) -> None:
    content = render(values)
    if not path.exists() or path.read_text(encoding="utf-8") != content:
        path.write_text(content, encoding="utf-8")
    path.chmod(0o600)


def build_environment_files(root: Path, home: Path) -> dict[str, dict[str, str]]:
    values = dotenv_values(root / "deploy/.env")
    for name in (
        "AGENT_GATEWAY_TOKEN",
        "ORCHESTRATOR_ALLOWED_USERS",
        "OLLAMA_BASE_URL",
        "OLLAMA_MODEL",
    ):
        required(values, name)

    runtime = home / "Library/Application Support/PipecatEdge"
    gondolin = runtime / "gondolin-agent"
    voice = runtime / "voice-pi-agent"
    wassette = values.get("WASSETTE_BIN") or shutil.which("wassette")
    if not wassette:
        raise SystemExit("Wassette is required; install it or set WASSETTE_BIN")

    common = {
        "GONDOLIN_BROWSER_ASSETS": str(runtime / "gondolin-assets"),
        "PI_CODING_AGENT_DIR": str(home / ".pi/agent"),
        "PI_VOICE_CWD": str(runtime / "voice-workspace"),
        "PI_VOICE_SESSION_DIR": str(runtime / "pi-voice-sessions"),
        "PI_VOICE_SKILLS_DIR": str(runtime / "skills"),
        "PI_VOICE_OXIGRAPH_CLI_DIR": str(voice / "cli"),
        "PI_VOICE_SERVICE_URL": "http://127.0.0.1:9446",
        "WASSETTE_BIN": wassette,
        "WASSETTE_COMPONENT_DIR": str(runtime / "wassette-components"),
        "GONDOLIN_METRICS_DIR": str(runtime / "gondolin-metrics"),
        "WASSETTE_ENV_FILE": str(runtime / "wassette-tasking.env"),
        "OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:4318",
        "OTEL_LOGS_EXPORTER": "none",
        "OTEL_METRIC_EXPORT_INTERVAL": "5000",
        "GITEA_TOKEN": secret(root, "gitea-agent-token"),
    }
    broker = (
        selected(values, BROKER_KEYS)
        | {"AGENT_GATEWAY_BASE_URL": "http://127.0.0.1:9444/v1"}
        | common
    )
    pi_voice = {
        key: value
        for key, value in broker.items()
        if key not in {"AGENT_GATEWAY_TOKEN", "ORCHESTRATOR_ALLOWED_USERS"}
    } | {
        "GRAFANA_MCP_URL": "http://127.0.0.1:8000/mcp",
        "GRAFANA_MCP_SERVER_TOKEN": secret(root, "grafana-mcp-caller-token"),
    }
    listener = {
        "AGENT_GATEWAY_TOKEN": required(values, "AGENT_GATEWAY_TOKEN"),
        "AGENT_GATEWAY_BASE_URL": "http://127.0.0.1:9444/v1",
        "ORCHESTRATOR_ALLOWED_USERS": required(values, "ORCHESTRATOR_ALLOWED_USERS"),
        "PI_VOICE_SESSION_DIR": str(runtime / "pi-voice-sessions"),
    }
    worker = selected(values, WORKER_KEYS) | {
        "PI_GONDOLIN_EXTENSION": str(gondolin / "dist/pi-extension.js"),
        "PI_TASK_SKILLS_DIR": str(runtime / "skills"),
        "GONDOLIN_BROWSER_ASSETS": str(runtime / "gondolin-assets"),
        "GONDOLIN_IMAGE_STORE": str(home / ".cache/gondolin/images"),
        "GONDOLIN_BROWSER_TOOLS": "0",
        "GONDOLIN_PUBLIC_INTERNET": "1",
        "PI_CODING_AGENT_DIR": str(home / ".pi/agent"),
        "GONDOLIN_METRICS_DIR": str(runtime / "gondolin-metrics"),
        "OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:4318",
        "OTEL_LOGS_EXPORTER": "none",
        "OTEL_METRIC_EXPORT_INTERVAL": "5000",
        "GITEA_PACKAGE_OWNER": "image-builder",
        "GITEA_BUILDER_TOKEN": secret(root, "gitea-builder-token"),
        "GITEA_ACTIONS_TOKEN": secret(root, "gitea-dispatcher-token"),
        "IMAGE_INSTALLER_CLI": str(gondolin / "dist/image-builder/installer.js"),
        "DIGITAL_TWIN_RUNNER": str(voice / "dist/digital-twin/runtime/task-runner.js"),
        "DIGITAL_TWIN_IMAGE_REF": "digital-twin-ingest:v1",
        "DIGITAL_TWIN_MODEL_BASE_URL": required(values, "OLLAMA_BASE_URL"),
        "DIGITAL_TWIN_MODEL": required(values, "OLLAMA_MODEL"),
        "DIGITAL_TWIN_WRITER_BASE_URL": "http://127.0.0.1:9444",
        "DIGITAL_TWIN_WRITER_TOKEN": secret(root, "digital-twin-writer-token"),
        "DIGITAL_TWIN_TIMEOUT_SECONDS": "120",
    }
    image_builder = {
        "GITEA_ENDPOINT_URL": "http://127.0.0.1:3001",
        "GITEA_RUNNER_REGISTRATION_TOKEN": secret(
            root, "gitea-runner-registration-token"
        ),
        "GONDOLIN_BUILDER_ASSETS": str(runtime / "gondolin-builder-assets"),
        "GONDOLIN_BUILDER_CHECKPOINT": str(
            runtime / "gondolin-builder-checkpoint.qcow2"
        ),
        "GONDOLIN_RUNNER_DIR": str(gondolin),
        "GONDOLIN_BUILDER_DISK": "128G",
        "OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:4318",
        "OTEL_LOGS_EXPORTER": "none",
        "OTEL_METRIC_EXPORT_INTERVAL": "5000",
    }
    wassette = {
        "TASK_GATEWAY_BASE_URL": "http://127.0.0.1:9444/v1",
        "TASK_GATEWAY_TOKEN": required(values, "AGENT_GATEWAY_TOKEN"),
        "TASK_IDENTITY": required(values, "ORCHESTRATOR_ALLOWED_USERS"),
        "KNOWLEDGE_GATEWAY_BASE_URL": "http://127.0.0.1:9444/v1",
        "KNOWLEDGE_GATEWAY_TOKEN": secret(root, "digital-twin-reader-token"),
        "KNOWLEDGE_IDENTITY": required(values, "ORCHESTRATOR_ALLOWED_USERS"),
    }
    return {
        "broker.env": broker,
        "pi-voice.env": pi_voice,
        "listener.env": listener,
        "worker.env": worker,
        "image-builder.env": image_builder,
        "wassette-tasking.env": wassette,
    }


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    output = root / "deploy/host-env"
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    output.chmod(0o700)
    for name, values in build_environment_files(root, Path.home()).items():
        write_environment(output / name, values)


if __name__ == "__main__":
    main()
