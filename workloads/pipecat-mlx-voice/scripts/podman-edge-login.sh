#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
machine_name="${PODMAN_EDGE_MACHINE:-pipecat-edge}"
status_file="$(mktemp)"
trap 'rm -f "$status_file"' EXIT

podman exec pipecat-tailscale tailscale status --json > "$status_file"
edge_url="$(python3 "$repo_dir/deploy/finalize_edge.py" "$repo_dir/edge/.env" "$status_file")"

identity="$(podman machine inspect --format '{{.SSHConfig.IdentityPath}}' "$machine_name")"
port="$(podman machine inspect --format '{{.SSHConfig.Port}}' "$machine_name")"
user="$(podman machine inspect --format '{{.SSHConfig.RemoteUsername}}' "$machine_name")"
scp -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new \
  -i "$identity" -P "$port" "$repo_dir/edge/.env" \
  "$user@127.0.0.1:.config/pipecat-edge/edge.env"
"$repo_dir/scripts/podman-edge-ssh.sh" \
  "chmod 600 ~/.config/pipecat-edge/edge.env && systemctl --user restart pipecat-edge.service"

podman exec pipecat-tailscale tailscale serve --bg --https=443 http://127.0.0.1:7860
podman exec pipecat-tailscale tailscale serve status
echo "Open: $edge_url"
