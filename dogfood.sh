#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
EXCALIDRAW_REPO="$ROOT_DIR/repos/excalidraw-mcp"
PIPELINE_DIR="$EXCALIDRAW_REPO/prototype-wassette-pi"
LAYOUT_REPO="$ROOT_DIR/repos/mermaid-to-excalidraw"
INPUT=${1:-"$PIPELINE_DIR/examples/composable-c4-pipeline.mmd"}
OUTPUT=${2:-"$ROOT_DIR/artifacts/composable-c4-pipeline.excalidraw"}

mkdir -p "$(dirname -- "$OUTPUT")"
export MERMAID_EXCALIDRAW_REPO="$LAYOUT_REPO"
node "$PIPELINE_DIR/run-composable-c4-pipeline.mjs" "$INPUT" "$OUTPUT"

if [ "${RENDER_PNG:-1}" = "1" ]; then
  PNG_OUTPUT=${OUTPUT%.excalidraw}.png
  node "$LAYOUT_REPO/scripts/render-excalidraw.mjs" "$OUTPUT" "$PNG_OUTPUT"
  echo "PNG: $PNG_OUTPUT"
fi
