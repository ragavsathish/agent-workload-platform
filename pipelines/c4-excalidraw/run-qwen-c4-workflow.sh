#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MONOREPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
REPO_DIR="$MONOREPO_ROOT/apps/excalidraw-mcp"
SOURCE_MMD=${1:-"$SCRIPT_DIR/examples/pi-wassette-excalidraw.mmd"}
ARTIFACT_DIR=${2:-"$SCRIPT_DIR/artifacts/qwen"}
MODEL=${PI_C4_MODEL:-lmstudio/qwen/qwen3.8-27b}
C4_SKILL=${PI_C4_SKILL:-/Users/sathish.narayanan/.codex/skills/c4-diagrams}

command -v mmdc >/dev/null || { echo "mmdc is required" >&2; exit 1; }
command -v pi >/dev/null || { echo "pi is required" >&2; exit 1; }
command -v wassette >/dev/null || { echo "wassette is required" >&2; exit 1; }
test -f "$SOURCE_MMD" || { echo "Mermaid source not found: $SOURCE_MMD" >&2; exit 1; }
test -d "$C4_SKILL" || { echo "C4 skill not found: $C4_SKILL" >&2; exit 1; }

mkdir -p "$ARTIFACT_DIR"
SOURCE_NAME=$(basename -- "$SOURCE_MMD")
SOURCE_STEM=${SOURCE_NAME%.mmd}
REFERENCE_PNG="$ARTIFACT_DIR/$SOURCE_STEM.mermaid.png"
STATE_JSON="$ARTIFACT_DIR/$SOURCE_STEM.excalidraw-state.json"

echo "[1/3] Rendering Mermaid reference: $REFERENCE_PNG"
mmdc --input "$SOURCE_MMD" --output "$REFERENCE_PNG" --backgroundColor transparent

echo "[2/3] Starting Qwen C4 worker; keep this session open while using the browser view"
cd "$REPO_DIR"
EXCALIDRAW_STATE_OUT="$STATE_JSON" pi \
  --model "$MODEL" \
  --thinking off \
  --system-prompt "You construct editable C4 Excalidraw scenes. Follow the loaded skill, attached source, visual reference, and tool contract exactly." \
  --no-context-files \
  --no-extensions \
  --no-builtin-tools \
  --tools excalidraw_wassette_open \
  --skill "$C4_SKILL" \
  --extension "$SCRIPT_DIR/pi-extension.ts" \
  -- \
  "@$SOURCE_MMD" \
  "@$REFERENCE_PNG" \
  "@$SCRIPT_DIR/prompts/mmd-png-to-excalidraw.md" \
  "/no_think"

echo "[3/3] Validating C4 semantics and editable scene structure: $STATE_JSON"
test -s "$STATE_JSON" || {
  echo "Qwen exited without producing validated Excalidraw state: $STATE_JSON" >&2
  exit 1
}
node "$SCRIPT_DIR/evaluate-c4.mjs" "$SOURCE_MMD" "$STATE_JSON"

if [[ ${EVALUATE_GOLDEN:-0} == 1 ]]; then
  echo "Evaluating this run against the golden regression fixture"
  node "$SCRIPT_DIR/evaluate-golden.mjs" \
    "$SCRIPT_DIR/artifacts/pi-wassette-excalidraw.excalidraw-state.json" \
    "$STATE_JSON"
fi
