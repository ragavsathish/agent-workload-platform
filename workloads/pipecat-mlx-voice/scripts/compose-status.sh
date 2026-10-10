#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose=(docker compose --env-file "$root/server/.env" -f "$root/deploy/compose.yml")
"${compose[@]}" ps
"${compose[@]}" exec -T tailscale tailscale --socket=/tmp/tailscaled.sock status || true
launchctl print "gui/$UID/com.sathish.pipecat-broker" | sed -n '1,20p'
launchctl print "gui/$UID/com.sathish.pipecat-worker" | sed -n '1,20p'
