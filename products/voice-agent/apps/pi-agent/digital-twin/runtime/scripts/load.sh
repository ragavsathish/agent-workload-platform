#!/usr/bin/env bash
set -euo pipefail

pi_agent="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
root="$(cd "$pi_agent/../.." && pwd)"
private_dir="${DIGITAL_TWIN_DIR:-$pi_agent/digital-twin/runtime/rdf/private}"
graph_base="${DIGITAL_TWIN_GRAPH_BASE:-urn:awp:digital-twin:graph:}"
compose=(docker compose --env-file "$root/deploy/.env" -f "$root/deploy/compose.yml")

# Validate the complete dataset before clearing any stored graph. Cross-file
# references (for example Message -> Person) are intentionally checked together.
uv run --with 'pyshacl>=0.30,<1' python "$pi_agent/digital-twin/runtime/scripts/validate.py" \
  --shapes "$pi_agent/digital-twin/runtime/rdf/shapes/profile.shacl.ttl" \
  "$private_dir"

load_graph() {
  local filename="$1"
  local graph="$2"
  local file="$private_dir/$filename"

  [[ -s "$file" ]] || {
    printf 'Missing private digital-twin source: %s\n' "$file" >&2
    return 1
  }

  printf 'CLEAR SILENT GRAPH <%s>' "$graph" \
    | "${compose[@]}" exec -T gitea wget -q -O - \
        --header 'Content-Type: application/sparql-update' \
        --post-file /dev/stdin \
        http://oxigraph:7878/update >/dev/null

  "${compose[@]}" exec -T gitea wget -q -O - \
    --header 'Content-Type: text/turtle' \
    --post-file /dev/stdin \
    "http://oxigraph:7878/store?graph=$graph" <"$file" >/dev/null

  printf 'Loaded %s into %s\n' "$filename" "$graph"
}

load_graph cv.ttl "${graph_base}cv"
load_graph conversation.ttl "${graph_base}conversation"
load_graph learning.ttl "${graph_base}learning"
load_graph provenance.ttl "${graph_base}provenance"

printf 'ASK { GRAPH <%scv> { ?cvS ?cvP ?cvO } GRAPH <%sconversation> { ?chatS ?chatP ?chatO } GRAPH <%slearning> { ?learningS ?learningP ?learningO } GRAPH <%sprovenance> { ?provS ?provP ?provO } }' \
  "$graph_base" "$graph_base" "$graph_base" "$graph_base" \
  | "${compose[@]}" exec -T gitea wget -q -O - \
      --header 'Accept: application/sparql-results+json' \
      --header 'Content-Type: application/sparql-query' \
      --post-file /dev/stdin \
      http://oxigraph:7878/query \
  | grep -q '"boolean":true'
printf 'Digital twin loaded and query-verified.\n'
