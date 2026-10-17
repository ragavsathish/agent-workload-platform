#!/usr/bin/env bash
set -euo pipefail

pi_agent="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
root="$(cd "$pi_agent/../.." && pwd)"
query_file="${1:-$pi_agent/digital-twin/runtime/rdf/queries/profile-summary.rq}"
compose=(docker compose --env-file "$root/deploy/.env" -f "$root/deploy/compose.yml")

[[ -f "$query_file" ]] || {
  printf 'SPARQL query file not found: %s\n' "$query_file" >&2
  exit 2
}

"${compose[@]}" exec -T gitea wget -q -O - \
  --header 'Accept: application/sparql-results+json' \
  --header 'Content-Type: application/sparql-query' \
  --post-file /dev/stdin \
  http://oxigraph:7878/query <"$query_file"
