#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
machine_name="${PODMAN_EDGE_MACHINE:-pipecat-edge}"

while true; do
  state="$(podman machine inspect --format '{{.State}}' "$machine_name" 2>/dev/null || true)"
  if [[ "$state" != "running" ]]; then
    "$repo_dir/scripts/podman-edge-create.sh"
  fi
  sleep 30
done
