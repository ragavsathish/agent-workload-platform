#!/usr/bin/env bash
set -euo pipefail

machine_name="${PODMAN_EDGE_MACHINE:-pipecat-edge}"
identity="$(podman machine inspect --format '{{.SSHConfig.IdentityPath}}' "$machine_name")"
port="$(podman machine inspect --format '{{.SSHConfig.Port}}' "$machine_name")"
user="$(podman machine inspect --format '{{.SSHConfig.RemoteUsername}}' "$machine_name")"

# This direction matters: the Mac initiates the connection. The VM gets access to
# only the loopback broker port, never an SSH route back into the Mac.
exec ssh \
  -NT \
  -o BatchMode=yes \
  -o ExitOnForwardFailure=yes \
  -o IdentitiesOnly=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o StrictHostKeyChecking=accept-new \
  -i "$identity" \
  -p "$port" \
  -R 127.0.0.1:9443:127.0.0.1:9443 \
  "$user@127.0.0.1"
