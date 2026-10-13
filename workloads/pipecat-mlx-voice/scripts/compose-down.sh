#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
docker compose --env-file "$root/server/.env" -f "$root/deploy/compose.yml" down

# Compose cannot stop the host-only MLX/Pi supervisor.
launchctl bootout "gui/$UID/com.sathish.pipecat-host-services" >/dev/null 2>&1 || true
