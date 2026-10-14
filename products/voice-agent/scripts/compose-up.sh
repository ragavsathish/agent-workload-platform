#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose=(docker compose --env-file "$root/deploy/.env" -f "$root/deploy/compose.yml")

cd "$root"
uv sync --project apps/broker --python 3.13 --frozen
uv sync --project apps/gateway --python 3.13 --frozen
uv sync --project apps/worker --python 3.13 --frozen
npm --prefix apps/web ci
npm --prefix apps/web run build
cp -n apps/edge/.env.example apps/edge/.env || true
uv run --project apps/gateway python deploy/prepare_edge_env.py apps/edge/.env
uv run --project apps/gateway python deploy/prepare_compose.py "$root"

"${compose[@]}" build
"${compose[@]}" up -d --wait --force-recreate postgres s3mock gitea
"$root/scripts/db-init.sh"
"$root/scripts/gitea-sync.sh"
"$root/scripts/install-launch-agents.sh"
"${compose[@]}" up -d --wait --force-recreate
"$root/scripts/compose-verify.sh"
