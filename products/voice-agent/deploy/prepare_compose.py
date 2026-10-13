"""Materialize Docker Compose secrets from the ignored host environment file."""

from __future__ import annotations

import os
import secrets
import sys
from pathlib import Path
from urllib.parse import quote

from dotenv import dotenv_values


def required(values: dict[str, str | None], name: str, minimum: int = 1) -> str:
    value = values.get(name) or ""
    if len(value) < minimum or value.startswith("replace-with-"):
        raise SystemExit(f"{name} must be configured in server/.env")
    return value


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    values = dotenv_values(root / "server/.env")
    broker = required(values, "INFERENCE_BROKER_TOKEN", 32)
    gateway = required(values, "AGENT_GATEWAY_TOKEN", 32)
    approval = required(values, "ORCHESTRATOR_APPROVAL_SECRET", 32)
    postgres = required(values, "POSTGRES_PASSWORD", 16)

    secrets_dir = root / "deploy/secrets"
    secrets_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    grafana_path = secrets_dir / "grafana-admin-password"
    configured_grafana = values.get("GRAFANA_ADMIN_PASSWORD") or ""
    if configured_grafana and not configured_grafana.startswith("replace-with-"):
        grafana = configured_grafana
    elif grafana_path.is_file():
        grafana = grafana_path.read_text(encoding="utf-8").strip()
    else:
        grafana = secrets.token_urlsafe(32)
    files = {
        "broker-token": broker,
        "agent-gateway-token": gateway,
        "approval-secret": approval,
        "postgres-password": postgres,
        "database-url": (
            f"postgresql://voice_agents:{quote(postgres, safe='')}@postgres:5432/voice_agents"
        ),
        "grafana-admin-password": grafana,
    }
    for name, value in files.items():
        path = secrets_dir / name
        path.write_text(value + "\n", encoding="utf-8")
        os.chmod(path, 0o600)


if __name__ == "__main__":
    main()
