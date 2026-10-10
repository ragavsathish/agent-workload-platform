#!/usr/bin/env bash
set -euo pipefail

machine_name="${PODMAN_EDGE_MACHINE:-pipecat-edge}"
identity="$(podman machine inspect --format '{{.SSHConfig.IdentityPath}}' "$machine_name")"
port="$(podman machine inspect --format '{{.SSHConfig.Port}}' "$machine_name")"
user="$(podman machine inspect --format '{{.SSHConfig.RemoteUsername}}' "$machine_name")"

exec ssh \
  -o BatchMode=yes \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=accept-new \
  -i "$identity" \
  -p "$port" \
  "$user@127.0.0.1" \
  "$@"
