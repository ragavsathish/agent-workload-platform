#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose=(docker compose --env-file "$root/server/.env" -f "$root/deploy/compose.yml")

cd "$root"
uv sync --project server --python 3.13 --frozen
npm --prefix client ci
npm --prefix client run build
cp -n edge/.env.example edge/.env || true
uv run --project server python deploy/prepare_edge_env.py edge/.env
uv run --project server python deploy/prepare_compose.py "$root"

"${compose[@]}" build
"${compose[@]}" up -d --wait postgres s3mock
"$root/scripts/db-init.sh"
"$root/scripts/install-launch-agents.sh"
"${compose[@]}" up -d --wait
"$root/scripts/compose-verify.sh"
