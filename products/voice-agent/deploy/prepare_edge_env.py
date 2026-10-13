"""Converge non-secret edge capability endpoints before every provision."""

import sys
from pathlib import Path


def main() -> None:
    path = Path(sys.argv[1])
    required = {
        "INFERENCE_BROKER_TOKEN_FILE": "/run/secrets/broker-token",
        "INFERENCE_BROKER_BASE_URL": "http://host.docker.internal:9443/v1",
        "AGENT_GATEWAY_TOKEN_FILE": "/run/secrets/agent-gateway-token",
        "AGENT_GATEWAY_BASE_URL": "http://agent-gateway:9444/v1",
    }
    lines = path.read_text(encoding="utf-8").splitlines()
    seen: set[str] = set()
    output: list[str] = []
    for line in lines:
        key = line.split("=", 1)[0]
        if key in required:
            output.append(f"{key}={required[key]}")
            seen.add(key)
        else:
            output.append(line)
    output.extend(f"{key}={value}" for key, value in required.items() if key not in seen)
    path.write_text("\n".join(output) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
