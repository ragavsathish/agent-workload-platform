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
    }
    lines = env_path.read_text(encoding="utf-8").splitlines()
    seen: set[str] = set()
    output: list[str] = []
    for line in lines:
        key = line.split("=", 1)[0]
        if key in replacements:
            output.append(f"{key}={replacements[key]}")
            seen.add(key)
        else:
            output.append(line)
    output.extend(f"{key}={value}" for key, value in replacements.items() if key not in seen)
    env_path.write_text("\n".join(output) + "\n", encoding="utf-8")
    print(f"https://{dns_name}")


if __name__ == "__main__":
    main()
