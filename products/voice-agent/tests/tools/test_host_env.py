from pathlib import Path

from tools.config.host_env import build_environment_files, render, write_environment


def test_host_environments_keep_service_secrets_separate(
    tmp_path: Path, monkeypatch
) -> None:
    root = tmp_path / "repo"
    deploy = root / "deploy"
    secrets = deploy / "secrets"
    secrets.mkdir(parents=True)
    deploy.joinpath(".env").write_text(
        "AGENT_GATEWAY_TOKEN=gateway\n"
        "ORCHESTRATOR_ALLOWED_USERS=owner@example.test\n"
        "OLLAMA_BASE_URL=http://127.0.0.1:11434\n"
        "OLLAMA_MODEL=qwen-test\n"
        "INFERENCE_BROKER_TOKEN=broker\n",
        encoding="utf-8",
    )
    secret_values = {
        "gitea-agent-token": "agent",
        "grafana-mcp-caller-token": "grafana",
        "gitea-builder-token": "builder",
        "gitea-dispatcher-token": "dispatcher",
        "digital-twin-writer-token": "writer",
        "gitea-runner-registration-token": "runner",
        "digital-twin-reader-token": "reader",
    }
    for name, value in secret_values.items():
        secrets.joinpath(name).write_text(value, encoding="utf-8")
    monkeypatch.setattr("tools.config.host_env.shutil.which", lambda _: "/bin/wassette")

    environments = build_environment_files(root, tmp_path / "home")

    assert environments["broker.env"]["GITEA_TOKEN"] == "agent"
    assert "GRAFANA_MCP_SERVER_TOKEN" not in environments["broker.env"]
    assert "AGENT_GATEWAY_TOKEN" not in environments["pi-voice.env"]
    assert environments["pi-voice.env"]["GRAFANA_MCP_SERVER_TOKEN"] == "grafana"
    assert environments["worker.env"]["DIGITAL_TWIN_WRITER_TOKEN"] == "writer"
    assert (
        environments["image-builder.env"]["GITEA_RUNNER_REGISTRATION_TOKEN"] == "runner"
    )
    assert environments["wassette-tasking.env"]["KNOWLEDGE_GATEWAY_TOKEN"] == "reader"


def test_environment_write_is_content_idempotent(tmp_path: Path) -> None:
    destination = tmp_path / "service.env"
    values = {"TOKEN": "value", "PATH_WITH_SPACE": "/a path/b"}

    write_environment(destination, values)
    first = destination.stat()
    write_environment(destination, values)

    assert destination.read_text(encoding="utf-8") == render(values)
    assert destination.stat().st_mtime_ns == first.st_mtime_ns
    assert destination.stat().st_mode & 0o777 == 0o600
