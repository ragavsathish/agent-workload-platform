"""Bind the edge allowlist to the authenticated Tailscale identity and DNS name."""

import json
import sys
from pathlib import Path


def main() -> None:
    env_path = Path(sys.argv[1])
    status = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    if status.get("BackendState") != "Running":
        raise SystemExit("Tailscale is not authenticated yet")

    self_node = status["Self"]
    dns_name = str(self_node["DNSName"]).rstrip(".")
    user_id = str(self_node["UserID"])
    users = status.get("User") or {}
    login = str(users[user_id]["LoginName"]).lower()
    if not dns_name or "@" not in login:
        raise SystemExit("Could not resolve the Tailscale DNS name or login identity")

    replacements = {
        "EDGE_ALLOWED_USERS": login,
        "PIPECAT_ALLOWED_ORIGINS": f"https://{dns_name}",
        # Raw Tailscale TCP plus the HTTP/1.1 TLS sidecar avoids Serve's HTTP/2
        # WebSocket proxy bug. Tokens travel in Pipecat's supported URL path.
        "PIPECAT_WEBSOCKET_AUTH": "token",
        "EDGE_SINGLE_USER_TCP_INGRESS": "true",
        "AGENT_GATEWAY_TOKEN_FILE": "/run/secrets/agent-gateway-token",
        "AGENT_GATEWAY_BASE_URL": "http://agent-gateway:9444/v1",
    }

    def update(path: Path, values: dict[str, str]) -> None:
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

    update(env_path, replacements)
    for host_env_name in sys.argv[3:]:
        host_env = Path(host_env_name)
        if host_env.is_file():
            update(host_env, {"ORCHESTRATOR_ALLOWED_USERS": login})
    print(f"https://{dns_name}")


if __name__ == "__main__":
    main()
