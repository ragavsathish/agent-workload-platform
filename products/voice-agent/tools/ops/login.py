"""Complete the interactive Tailscale login and expose the Compose services."""

from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = [
    "docker",
    "compose",
    "--env-file",
    str(ROOT / "deploy/.env"),
    "-f",
    str(ROOT / "deploy/compose.yml"),
]


def run(*args: str, capture_output: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run([*args], check=True, text=True, capture_output=capture_output)


def update_env(path: Path, values: dict[str, str]) -> None:
    lines = path.read_text(encoding="utf-8").splitlines()
    seen: set[str] = set()
    output: list[str] = []
    for line in lines:
        key = line.split("=", 1)[0]
        if key in values:
            output.append(f"{key}={values[key]}")
            seen.add(key)
        else:
            output.append(line)
    output.extend(f"{key}={value}" for key, value in values.items() if key not in seen)
    path.write_text("\n".join(output) + "\n", encoding="utf-8")


def finalize_edge(status: dict[str, Any], edge_env: Path, deploy_env: Path) -> str:
    if status.get("BackendState") != "Running":
        raise SystemExit("Tailscale is not authenticated yet")
    self_node = status["Self"]
    if not isinstance(self_node, dict):
        raise SystemExit("Tailscale did not return the local node")
    dns_name = str(self_node["DNSName"]).rstrip(".")
    user_id = str(self_node["UserID"])
    users = status.get("User") or {}
    if not isinstance(users, dict) or not isinstance(users.get(user_id), dict):
        raise SystemExit("Tailscale did not return the authenticated identity")
    login = str(users[user_id]["LoginName"]).lower()
    if not dns_name or "@" not in login:
        raise SystemExit("Could not resolve the Tailscale DNS name or login identity")
    update_env(
        edge_env,
        {
            "EDGE_ALLOWED_USERS": login,
            "PIPECAT_ALLOWED_ORIGINS": f"https://{dns_name}",
        },
    )
    update_env(
        deploy_env,
        {
            "ORCHESTRATOR_ALLOWED_USERS": login,
            "GRAFANA_ROOT_URL": f"https://{dns_name}/metrics/",
            "GITEA_ROOT_URL": f"https://{dns_name}/git/",
            "TAILSCALE_GITEA_ADMIN_LOGIN": login,
        },
    )
    return f"https://{dns_name}"


def has_tailnet_admin(listing: str, email: str) -> bool:
    return any(
        len(fields) >= 3 and fields[1] == "tailnet-admin" and fields[2].lower() == email
        for fields in (line.split() for line in listing.splitlines())
    )


def ensure_tailnet_admin(email: str) -> None:
    listing = run(*COMPOSE, "exec", "-T", "gitea", "gitea", "admin", "user", "list",
                  "--admin", capture_output=True).stdout
    if has_tailnet_admin(listing, email):
        return
    run(
        *COMPOSE, "exec", "-T", "gitea", "gitea", "admin", "user", "create",
        "--username", "tailnet-admin", "--email", email, "--admin", "--random-password",
        "--random-password-length", "48", "--must-change-password=false",
        capture_output=True,
    )


def main() -> None:
    last_auth_url = ""
    status: dict[str, Any] = {}
    for _ in range(600):
        result = run(
            *COMPOSE,
            "exec",
            "-T",
            "tailscale",
            "tailscale",
            "--socket=/tmp/tailscaled.sock",
            "status",
            "--json",
            capture_output=True,
        )
        status = json.loads(result.stdout)
        if status.get("BackendState") == "Running":
            break
        auth_url = str(status.get("AuthURL") or "")
        if auth_url and auth_url != last_auth_url:
            print(f"Authenticate the pipecat-edge device at:\n\n  {auth_url}\n", flush=True)
            last_auth_url = auth_url
        time.sleep(1)
    else:
        raise SystemExit("Tailscale did not reach Running state within 10 minutes")

    url = finalize_edge(
        status,
        ROOT / "apps/edge/.env",
        ROOT / "deploy/.env",
    )
    run(
        *COMPOSE,
        "up",
        "-d",
        "--wait",
        "--force-recreate",
        "gitea",
        "gitea-ingress",
        "otel-lgtm",
        "agent-gateway",
        "voice-edge",
        "traefik",
    )
    owner_login = str(status["User"][str(status["Self"]["UserID"])]["LoginName"]).lower()
    ensure_tailnet_admin(owner_login)
    tailscale = [
        *COMPOSE,
        "exec",
        "-T",
        "tailscale",
        "tailscale",
        "--socket=/tmp/tailscaled.sock",
        "serve",
    ]
    run(*tailscale, "reset")
    run(*tailscale, "--bg", "--https=443", "http://127.0.0.1:8080")
    run(*tailscale, "--bg", "--https=443", "--set-path=/git", "unix:/run/gitea-ingress/gitea.sock")
    print(f"Voice UI: {url}")
    print(f"Grafana: {url}/metrics/")
    print(f"Gitea: {url}/git/")
    print(f"Durable queue: {url}/queue/")


if __name__ == "__main__":
    main()
