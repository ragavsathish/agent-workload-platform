#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MONOREPO_ROOT=$(CDPATH= cd -- "$ROOT_DIR/../.." && pwd)
PIPELINE_DIR="$ROOT_DIR"
LAYOUT_REPO="$MONOREPO_ROOT/packages/mermaid-to-excalidraw"
INPUT=${1:-"$PIPELINE_DIR/examples/composable-c4-pipeline.mmd"}
OUTPUT=${2:-"$MONOREPO_ROOT/artifacts/c4-excalidraw/composable-c4-pipeline.excalidraw"}

mkdir -p "$(dirname -- "$OUTPUT")"
export MERMAID_EXCALIDRAW_REPO="$LAYOUT_REPO"
node "$PIPELINE_DIR/run-composable-c4-pipeline.mjs" "$INPUT" "$OUTPUT"

if [ "${RENDER_PNG:-1}" = "1" ]; then
  PNG_OUTPUT=${OUTPUT%.excalidraw}.png
  node "$LAYOUT_REPO/scripts/render-excalidraw.mjs" "$OUTPUT" "$PNG_OUTPUT"
  echo "PNG: $PNG_OUTPUT"
fi
