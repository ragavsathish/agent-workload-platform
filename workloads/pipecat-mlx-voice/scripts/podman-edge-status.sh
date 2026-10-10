#!/usr/bin/env bash
set -euo pipefail

podman machine inspect "${PODMAN_EDGE_MACHINE:-pipecat-edge}" \
  --format 'machine={{.Name}} state={{.State}} cpus={{.Resources.CPUs}} memory={{.Resources.Memory}} rootful={{.Rootful}}'
podman ps --pod --format 'table {{.Names}}\t{{.Status}}\t{{.PodName}}\t{{.Networks}}'
podman exec pipecat-tailscale tailscale status || true
