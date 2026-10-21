from pathlib import Path

from tools.ops.login import finalize_edge


def test_binds_edge_and_ingress_urls_to_tailscale_identity(tmp_path: Path) -> None:
    edge_env = tmp_path / "edge.env"
    deploy_env = tmp_path / "deploy.env"
    edge_env.write_text("EDGE_ALLOWED_USERS=old@example.com\n", encoding="utf-8")
    deploy_env.write_text(
        "ORCHESTRATOR_ALLOWED_USERS=old@example.com\n"
        "GRAFANA_ROOT_URL=http://127.0.0.1:3300/\n"
        "GITEA_ROOT_URL=http://127.0.0.1:3001/\n",
        encoding="utf-8",
    )
    status = {
        "BackendState": "Running",
        "Self": {"DNSName": "voice.example.ts.net.", "UserID": 42},
        "User": {"42": {"LoginName": "Owner@Example.com"}},
    }

    url = finalize_edge(status, edge_env, deploy_env)

    assert url == "https://voice.example.ts.net"
    assert "EDGE_ALLOWED_USERS=owner@example.com" in edge_env.read_text(encoding="utf-8")
    deployed = deploy_env.read_text(encoding="utf-8")
    assert "ORCHESTRATOR_ALLOWED_USERS=owner@example.com" in deployed
    assert "GRAFANA_ROOT_URL=https://voice.example.ts.net/metrics/" in deployed
    assert "GITEA_ROOT_URL=https://voice.example.ts.net/git/" in deployed
