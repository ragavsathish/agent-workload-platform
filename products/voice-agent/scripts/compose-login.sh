#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose=(docker compose --env-file "$root/deploy/.env" -f "$root/deploy/compose.yml")
status_file="$(mktemp)"
trap 'rm -f "$status_file"' EXIT

last_auth_url=""
for _ in {1..600}; do
  "${compose[@]}" exec -T tailscale tailscale --socket=/tmp/tailscaled.sock status --json > "$status_file"
  read -r state auth_url < <(python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("BackendState", "unknown"), d.get("AuthURL", ""))' < "$status_file")
  if [[ "$state" == Running ]]; then
    break
  fi
  if [[ -n "$auth_url" && "$auth_url" != "$last_auth_url" ]]; then
    printf 'Authenticate the pipecat-edge device at:\n\n  %s\n\n' "$auth_url"
    last_auth_url="$auth_url"
  fi
  sleep 1
done
[[ "$state" == Running ]] || { echo "Tailscale did not reach Running state within 10 minutes" >&2; exit 1; }

url="$(uv run --project "$root/apps/gateway" python "$root/deploy/finalize_edge.py" "$root/apps/edge/.env" "$status_file" "$root/deploy/.env")"
uv run --project "$root/apps/gateway" python "$root/deploy/prepare_compose.py" "$root"
"${compose[@]}" up -d --wait --force-recreate gitea habitat otel-lgtm agent-gateway voice-edge traefik
"${compose[@]}" exec -T tailscale tailscale --socket=/tmp/tailscaled.sock serve reset
"${compose[@]}" exec -T tailscale tailscale --socket=/tmp/tailscaled.sock serve \
  --bg --https=443 http://127.0.0.1:8080
echo "Voice UI: $url"
echo "Grafana: ${url}/metrics/"
echo "Gitea: ${url}/git/"
echo "Durable queue: ${url}/queue/"
