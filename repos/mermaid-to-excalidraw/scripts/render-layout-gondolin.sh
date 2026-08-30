#!/bin/sh
set -eu

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "usage: $0 INPUT.mmd OUTPUT.json [ARCH]" >&2
  exit 2
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/gondolin-common.sh"

INPUT_ARG=$1
OUTPUT_ARG=$2
ARCH=$(resolve_gondolin_arch "${3:-}")
PLAYWRIGHT_VERSION=1.58.2
GONDOLIN_IMAGE="mermaid-layout:playwright-$PLAYWRIGHT_VERSION-$ARCH"
INPUT_DIR=$(CDPATH= cd -- "$(dirname -- "$INPUT_ARG")" && pwd)
INPUT_NAME=$(basename -- "$INPUT_ARG")
OUTPUT_PARENT=$(dirname -- "$OUTPUT_ARG")
mkdir -p "$OUTPUT_PARENT"
OUTPUT_DIR=$(CDPATH= cd -- "$OUTPUT_PARENT" && pwd)
OUTPUT_NAME=$(basename -- "$OUTPUT_ARG")

run_gondolin \
  exec \
  --image "$GONDOLIN_IMAGE" \
  --mount-hostfs "$INPUT_DIR:/input:ro" \
  --mount-hostfs "$OUTPUT_DIR:/output" \
  -- \
  /usr/bin/node \
  /app/scripts/render-layout-snapshot.mjs \
  "/input/$INPUT_NAME" \
  "/output/$OUTPUT_NAME"
