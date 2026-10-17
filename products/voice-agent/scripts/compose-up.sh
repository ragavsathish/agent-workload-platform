#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose=(docker compose --env-file "$root/deploy/.env" -f "$root/deploy/compose.yml")

cd "$root"
uv sync --project apps/broker --python 3.13 --frozen
uv sync --project apps/gateway --python 3.13 --frozen
uv sync --project apps/worker --python 3.13 --frozen
npm --prefix apps/client ci
npm --prefix apps/client run build
npm --prefix apps/diagnostics ci
npm --prefix apps/diagnostics run build
make -C "$root" grafana-c4-dashboard
# The shared Gondolin builder is bootstrap infrastructure. Gitea Actions owns
# repository workload builds; install-launch-agents validates existing assets.
cp -n apps/edge/.env.example apps/edge/.env || true
uv run --project apps/gateway python deploy/prepare_edge_env.py apps/edge/.env
uv run --project apps/gateway python deploy/prepare_compose.py "$root"

"${compose[@]}" build
"${compose[@]}" up -d --wait --force-recreate postgres s3mock gitea
"$root/scripts/db-init.sh"
"$root/scripts/gitea-sync.sh"
make -C "$root" wassette-arxiv-install
make -C "$root" wassette-tasking-install
"$root/scripts/install-launch-agents.sh"
"${compose[@]}" up -d --wait --force-recreate
"$root/scripts/compose-verify.sh"
