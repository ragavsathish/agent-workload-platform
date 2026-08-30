#!/bin/sh
set -eu

CONTRACT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROTOTYPE_DIR=$(CDPATH= cd -- "$CONTRACT_DIR/../.." && pwd)
JCO=${JCO_BIN:-"$PROTOTYPE_DIR/core/node_modules/.bin/jco"}

if [ ! -x "$JCO" ]; then
  echo "Missing jco at $JCO; run pnpm install --frozen-lockfile --ignore-scripts first" >&2
  exit 1
fi

OUTPUT_DIR=$(mktemp -d)
trap 'rm -rf "$OUTPUT_DIR"' EXIT HUP INT TERM

for world in c4-engine c4-compiler-core excalidraw-policy-component; do
  "$JCO" types "$CONTRACT_DIR/wit" \
    --world-name "$world" \
    --out-dir "$OUTPUT_DIR/$world" \
    --quiet
done

echo "Validated WIT worlds: c4-engine, c4-compiler-core, excalidraw-policy-component"
