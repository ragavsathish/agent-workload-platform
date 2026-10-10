#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose=(docker compose --env-file "$root/server/.env" -f "$root/deploy/compose.yml")

for cycle in 1 2 3; do
  echo "Lifecycle cycle $cycle/3"
  "${compose[@]}" up -d --wait --force-recreate
  "$root/scripts/db-init.sh"
  "$root/scripts/compose-verify.sh"
  "${compose[@]}" stop
done
"${compose[@]}" up -d --wait
"$root/scripts/compose-verify.sh"
echo "Three stop/recreate cycles passed with persistent state."
