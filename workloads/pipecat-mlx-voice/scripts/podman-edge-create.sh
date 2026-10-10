#!/usr/bin/env bash
set -euo pipefail

machine_name="${PODMAN_EDGE_MACHINE:-pipecat-edge}"
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
machine_config="$repo_dir/deploy/podman-containers.conf"
machine_image="docker://quay.io/podman/machine-os@sha256:ae301d1f40235c67c18653b18f25e5a294381cf3963068e5aa4922583cfbebdd"

if podman machine inspect "$machine_name" >/dev/null 2>&1; then
  state="$(podman machine inspect --format '{{.State}}' "$machine_name")"
  if [[ "$state" != "running" ]]; then
    podman machine start "$machine_name"
  fi
else
  # The dedicated containers.conf overrides Podman's macOS home-directory
  # defaults with an actually empty volume list.
  CONTAINERS_CONF="$machine_config" podman machine init \
    --provider libkrun \
    --cpus 4 \
    --memory 4096 \
    --disk-size 24 \
    --image "$machine_image" \
    --now \
    "$machine_name"
fi

podman machine inspect "$machine_name"
