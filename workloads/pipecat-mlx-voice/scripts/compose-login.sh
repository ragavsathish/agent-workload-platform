#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose=(docker compose --env-file "$root/server/.env" -f "$root/deploy/compose.yml")
status_file="$(mktemp)"
trap 'rm -f "$status_file"' EXIT

"${compose[@]}" exec -T tailscale tailscale --socket=/tmp/tailscaled.sock up --hostname pipecat-edge
"${compose[@]}" exec -T tailscale tailscale --socket=/tmp/tailscaled.sock status --json > "$status_file"
url="$(uv run --project "$root/server" python "$root/deploy/finalize_edge.py" "$root/edge/.env" "$status_file" "$root/server/.env")"
uv run --project "$root/server" python "$root/deploy/prepare_compose.py" "$root"
"${compose[@]}" up -d --wait --force-recreate agent-gateway voice-edge
"${compose[@]}" exec -T tailscale tailscale --socket=/tmp/tailscaled.sock serve --bg --https=443 http://127.0.0.1:7860
echo "Voice UI: $url"
