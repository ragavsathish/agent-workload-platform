#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ $# -ge 1 ]] || { echo "usage: $0 <synthetic utterance> [...]" >&2; exit 2; }

compose=(docker compose --env-file "$repo_dir/server/.env" -f "$repo_dir/deploy/compose.yml")
if [[ "${BLACKBOX_USE_TAILSCALE:-false}" != "true" ]]; then
  compose+=(-f "$repo_dir/deploy/compose.local-test.yml")
fi

if [[ "${BLACKBOX_SKIP_UP:-false}" != "true" ]]; then
  ORCHESTRATOR_ALLOWED_USERS="${BLACKBOX_IDENTITY:-you@example.com}" \
    "${compose[@]}" up -d --wait --build tailscale s3mock agent-gateway voice-edge >/dev/null
fi
"${compose[@]}" \
  exec -T voice-edge /app/.venv/bin/python - "$@" < "$repo_dir/scripts/blackbox_voice.py"
