#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose=(docker compose --env-file "$root/server/.env" -f "$root/deploy/compose.yml")
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

url="$(uv run --project "$root/server" python "$root/deploy/finalize_edge.py" "$root/edge/.env" "$status_file" "$root/server/.env")"
dns_name="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' < "$status_file")"
uv run --project "$root/server" python "$root/deploy/prepare_compose.py" "$root"
"${compose[@]}" up -d --wait --force-recreate agent-gateway voice-edge
"${compose[@]}" exec -T tailscale tailscale --socket=/tmp/tailscaled.sock serve reset
"${compose[@]}" exec -T tailscale tailscale --socket=/tmp/tailscaled.sock cert \
  --cert-file /certs/tailnet.crt --key-file /certs/tailnet.key "$dns_name"
"${compose[@]}" exec -T tailscale chmod 0640 /certs/tailnet.crt /certs/tailnet.key
"${compose[@]}" up -d --wait --build --force-recreate tls-edge
"${compose[@]}" exec -T tailscale tailscale --socket=/tmp/tailscaled.sock serve --bg --tcp=443 tcp://127.0.0.1:8443
echo "Voice UI: $url"
