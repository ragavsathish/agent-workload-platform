#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MONOREPO_ROOT=$(CDPATH= cd -- "$ROOT_DIR/../.." && pwd)
PIPELINE_DIR="$ROOT_DIR"
LAYOUT_REPO="$MONOREPO_ROOT/adapters/mermaid-to-excalidraw"

echo "[1/5] Validating WIT contracts"
sh "$PIPELINE_DIR/contracts/c4-pipeline/validate.sh"

echo "[2/5] Building Wasm modules"
npm --prefix "$PIPELINE_DIR/core" run build
npm --prefix "$PIPELINE_DIR/components" run build

echo "[3/5] Building the Mermaid adapter"
npm --prefix "$PIPELINE_DIR" audit --audit-level=high
npm --prefix "$PIPELINE_DIR" run build:host
npm --prefix "$LAYOUT_REPO" run build

echo "[4/5] Running Mermaid adapter tests"
(
  cd "$LAYOUT_REPO"
  ./node_modules/.bin/vitest --run \
    tests/c4.test.ts \
    tests/cssUtils.test.ts \
    tests/examples.test.ts \
    tests/sequence.test.ts \
    tests/state.test.ts \
    tests/utils.test.ts
)

echo "[5/5] Checking scripts and diffs"
bash -n \
  "$PIPELINE_DIR/setup.sh" \
  "$PIPELINE_DIR/check.sh" \
  "$PIPELINE_DIR/run.sh"
node --check "$PIPELINE_DIR/run-composable-c4-pipeline.mjs"
node --check "$LAYOUT_REPO/scripts/render-layout-snapshot.mjs"
node --check "$LAYOUT_REPO/scripts/render-excalidraw.mjs"
git -C "$MONOREPO_ROOT" diff --check

echo "All checks passed"
