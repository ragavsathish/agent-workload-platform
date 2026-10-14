import json
import subprocess
import sys
from pathlib import Path


def test_binds_edge_and_ingress_urls_to_tailscale_identity(tmp_path: Path) -> None:
    edge_env = tmp_path / "edge.env"
    deploy_env = tmp_path / "deploy.env"
    status = tmp_path / "status.json"
    edge_env.write_text("EDGE_ALLOWED_USERS=old@example.com\n", encoding="utf-8")
    deploy_env.write_text(
        "ORCHESTRATOR_ALLOWED_USERS=old@example.com\n"
        "GRAFANA_ROOT_URL=http://127.0.0.1:3300/\n"
        "GITEA_ROOT_URL=http://127.0.0.1:3001/\n",
        encoding="utf-8",
    )
    status.write_text(
        json.dumps(
            {
                "BackendState": "Running",
                "Self": {"DNSName": "voice.example.ts.net.", "UserID": 42},
                "User": {"42": {"LoginName": "Owner@Example.com"}},
            }
        ),
        encoding="utf-8",
    )

    script = Path(__file__).with_name("finalize_edge.py")
    completed = subprocess.run(
        [sys.executable, script, edge_env, status, deploy_env],
        check=True,
        capture_output=True,
        text=True,
    )

    assert completed.stdout.strip() == "https://voice.example.ts.net"
    assert "EDGE_ALLOWED_USERS=owner@example.com" in edge_env.read_text(encoding="utf-8")
    deployed = deploy_env.read_text(encoding="utf-8")
    assert "ORCHESTRATOR_ALLOWED_USERS=owner@example.com" in deployed
    assert "GRAFANA_ROOT_URL=https://voice.example.ts.net/metrics/" in deployed
    assert "GITEA_ROOT_URL=https://voice.example.ts.net/git/" in deployed
