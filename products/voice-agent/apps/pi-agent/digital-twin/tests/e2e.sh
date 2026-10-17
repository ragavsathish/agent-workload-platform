#!/usr/bin/env bash
set -euo pipefail

pi_agent="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
root="$(cd "$pi_agent/../.." && pwd)"
compose=(docker compose --env-file "$root/deploy/.env" -f "$root/deploy/compose.yml")
graph_base="urn:awp:digital-twin:test:$$:graph:"

clear_test_graphs() {
  for graph in cv conversation learning provenance; do
    printf 'CLEAR SILENT GRAPH <%s%s>' "$graph_base" "$graph" \
      | "${compose[@]}" exec -T gitea wget -q -O - \
          --header 'Content-Type: application/sparql-update' \
          --post-file /dev/stdin \
          http://oxigraph:7878/update >/dev/null || true
  done
}
trap clear_test_graphs EXIT

DIGITAL_TWIN_DIR="$pi_agent/digital-twin/runtime/rdf/example" \
DIGITAL_TWIN_GRAPH_BASE="$graph_base" \
  "$pi_agent/digital-twin/runtime/scripts/load.sh"

result="$(
  printf 'SELECT (COUNT(*) AS ?triples) WHERE { GRAPH ?graph { ?s ?p ?o } FILTER(STRSTARTS(STR(?graph), "%s")) }' "$graph_base" \
    | "${compose[@]}" exec -T gitea wget -q -O - \
        --header 'Accept: application/sparql-results+json' \
        --header 'Content-Type: application/sparql-query' \
        --post-file /dev/stdin \
        http://oxigraph:7878/query
)"

triples="$(sed -n 's/.*"value":"\([0-9][0-9]*\)".*/\1/p' <<<"$result")"
[[ "$triples" =~ ^[0-9]+$ && "$triples" -gt 0 ]] || {
  printf 'Expected temporary digital-twin triples, got: %s\n' "$result" >&2
  exit 1
}

printf 'PASS  temporary digital twin loaded %s triples into isolated named graphs\n' "$triples"
