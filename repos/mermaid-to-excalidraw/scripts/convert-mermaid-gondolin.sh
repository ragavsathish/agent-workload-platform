#!/bin/sh
set -eu

if [ "$#" -lt 2 ] || [ "$#" -gt 4 ]; then
  echo "usage: $0 INPUT.mmd OUTPUT.excalidraw [PREVIEW.png] [ARCH]" >&2
  exit 2
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/gondolin-common.sh"

INPUT_ARG=$1
OUTPUT_ARG=$2
PREVIEW_ARG=${3:-}
ARCH=$(resolve_gondolin_arch "${4:-}")
PLAYWRIGHT_VERSION=1.58.2
GONDOLIN_IMAGE="mermaid-layout:playwright-$PLAYWRIGHT_VERSION-$ARCH"

INPUT_DIR=$(CDPATH= cd -- "$(dirname -- "$INPUT_ARG")" && pwd)
INPUT_NAME=$(basename -- "$INPUT_ARG")
OUTPUT_PARENT=$(dirname -- "$OUTPUT_ARG")
mkdir -p "$OUTPUT_PARENT"
OUTPUT_DIR=$(CDPATH= cd -- "$OUTPUT_PARENT" && pwd)
OUTPUT_NAME=$(basename -- "$OUTPUT_ARG")

set -- \
  exec \
  --image "$GONDOLIN_IMAGE" \
  --mount-hostfs "$INPUT_DIR:/input:ro" \
  --mount-hostfs "$OUTPUT_DIR:/output" \
  -- \
  /usr/bin/node \
  /app/scripts/convert-mermaid.mjs \
  "/input/$INPUT_NAME" \
  "/output/$OUTPUT_NAME"

if [ -n "$PREVIEW_ARG" ]; then
  PREVIEW_PARENT=$(dirname -- "$PREVIEW_ARG")
  mkdir -p "$PREVIEW_PARENT"
  PREVIEW_DIR=$(CDPATH= cd -- "$PREVIEW_PARENT" && pwd)
  if [ "$PREVIEW_DIR" != "$OUTPUT_DIR" ]; then
    echo "Preview and Excalidraw output must use the same directory" >&2
    exit 2
  fi
  PREVIEW_NAME=$(basename -- "$PREVIEW_ARG")
  set -- "$@" "/output/$PREVIEW_NAME"
fi

run_gondolin "$@"
