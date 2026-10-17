#!/usr/bin/env bash
set -euo pipefail

pi_agent="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
root="$(cd "$pi_agent/../.." && pwd)"
compose=(docker compose --env-file "$root/deploy/.env" -f "$root/deploy/compose.yml")
capture_file="$(mktemp)"
update_file="$(mktemp)"
trap 'rm -f "$capture_file" "$update_file"' EXIT

pnpm --dir "$pi_agent" build >/dev/null
node "$pi_agent/digital-twin/runtime/capture-journal.mjs" >"$capture_file"
node "$pi_agent/digital-twin/runtime/journal-to-sparql.mjs" <"$capture_file" >"$update_file"

"${compose[@]}" exec -T gitea wget -q -O - \
  --header 'Content-Type: application/sparql-update' \
  --post-file /dev/stdin \
  http://oxigraph:7878/update <"$update_file" >/dev/null

cat "$capture_file"
