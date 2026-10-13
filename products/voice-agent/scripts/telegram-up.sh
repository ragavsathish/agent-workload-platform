#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
base="$root/deploy/compose.yml"
telegram="$root/deploy/compose.telegram.yml"
env_file="$root/server/.env"
compose=(docker compose --env-file "$env_file" -f "$base" -f "$telegram")

uv run --project "$root/server" python "$root/deploy/prepare_telegram.py" "$root"
"${compose[@]}" build agent-gateway
"${compose[@]}" up -d --wait --force-recreate agent-gateway task-telegram
"${compose[@]}" ps agent-gateway task-telegram
