#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ $# -ge 1 ]] || { echo "usage: $0 <synthetic utterance> [...]" >&2; exit 2; }

base_compose=(docker compose --env-file "$repo_dir/server/.env" -f "$repo_dir/deploy/compose.yml")
compose=("${base_compose[@]}")
tailnet_mode="${BLACKBOX_USE_TAILSCALE:-auto}"
if [[ "$tailnet_mode" == "auto" ]]; then
  if "${base_compose[@]}" exec -T tailscale \
    tailscale --socket=/tmp/tailscaled.sock status >/dev/null 2>&1; then
    tailnet_mode="true"
  else
    tailnet_mode="false"
  fi
fi
if [[ "$tailnet_mode" != "true" ]]; then
  compose+=(-f "$repo_dir/deploy/compose.local-test.yml")
fi

if [[ "${BLACKBOX_SKIP_UP:-false}" != "true" ]]; then
  ORCHESTRATOR_ALLOWED_USERS="${BLACKBOX_IDENTITY:-you@example.com}" \
    "${compose[@]}" up -d --wait --build tailscale s3mock agent-gateway voice-edge >/dev/null
fi
probe_args=("$@")
if [[ -n "${BLACKBOX_IDENTITY:-}" ]]; then
  probe_args+=(--identity "$BLACKBOX_IDENTITY")
fi
"${compose[@]}" \
  exec -T voice-edge /app/.venv/bin/python - "${probe_args[@]}" < "$repo_dir/scripts/smallwebrtc_voice.py"
