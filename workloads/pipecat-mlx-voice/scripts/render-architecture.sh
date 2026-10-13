#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
architecture_dir="$root/docs/architecture"
output_dir="$architecture_dir/generated"
structurizr_image="${STRUCTURIZR_IMAGE:-structurizr/structurizr:latest}"

command -v docker >/dev/null || { echo "Docker is required to validate the Structurizr workspace" >&2; exit 1; }
command -v mmdc >/dev/null || { echo "Mermaid CLI (mmdc) is required to render generated previews" >&2; exit 1; }

mkdir -p "$output_dir/mermaid" "$output_dir/png" "$output_dir/svg"

docker run --rm \
  -v "$architecture_dir:/workspace" \
  "$structurizr_image" validate -w /workspace/workspace.dsl

docker run --rm \
  -v "$architecture_dir:/workspace" \
  "$structurizr_image" export \
  -w /workspace/workspace.dsl \
  -f mermaid \
  -o /workspace/generated/mermaid

for source in "$output_dir"/mermaid/*.mmd; do
  name="$(basename "$source" .mmd)"
  mmdc -i "$source" -o "$output_dir/png/$name.png" -q
  mmdc -i "$source" -o "$output_dir/svg/$name.svg" -q
done

echo "Architecture model validated and previews written to $output_dir"
