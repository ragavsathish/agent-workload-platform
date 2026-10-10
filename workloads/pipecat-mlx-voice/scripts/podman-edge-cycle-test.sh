#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
machine_name="${PODMAN_EDGE_MACHINE:-pipecat-edge}"
cycles="${EDGE_TEST_CYCLES:-3}"

[[ "$cycles" =~ ^[1-9][0-9]*$ ]] || { echo "EDGE_TEST_CYCLES must be a positive integer" >&2; exit 2; }

for ((cycle = 1; cycle <= cycles; cycle++)); do
  echo "== Immutable provision cycle $cycle/$cycles =="
  "$repo_dir/scripts/podman-edge-provision.sh"
  "$repo_dir/scripts/podman-edge-ssh.sh" "systemctl --user restart pipecat-edge.service; systemctl --user restart pipecat-tailscale.service"
  "$repo_dir/scripts/podman-edge-verify.sh"
done

echo "== VM stop/recovery cycle =="
podman machine stop "$machine_name"
for _ in {1..45}; do
  state="$(podman machine inspect --format '{{.State}}' "$machine_name" 2>/dev/null || true)"
  if [[ "$state" == "running" ]] \
    && [[ "$(podman inspect pipecat-edge-app --format '{{.State.Running}}' 2>/dev/null || true)" == "true" ]] \
    && [[ "$(podman inspect pipecat-tailscale --format '{{.State.Running}}' 2>/dev/null || true)" == "true" ]]; then
    break
  fi
  sleep 2
done

"$repo_dir/scripts/podman-edge-verify.sh"
echo "Completed $cycles immutable provision cycles and one host-managed VM recovery cycle."
