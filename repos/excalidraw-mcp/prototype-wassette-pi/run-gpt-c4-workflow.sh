#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(dirname -- "$SCRIPT_DIR")
SOURCE_MMD=${1:-"$SCRIPT_DIR/examples/pi-wassette-excalidraw.mmd"}
ARTIFACT_DIR=${2:-"$SCRIPT_DIR/artifacts"}
MODEL=${PI_C4_MODEL:-openai-codex/gpt-5.6-terra}
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

echo "[1/2] Rendering Mermaid reference: $REFERENCE_PNG"
mmdc --input "$SOURCE_MMD" --output "$REFERENCE_PNG" --backgroundColor transparent

echo "[2/2] Starting GPT C4 worker; keep this session open while using the browser view"
cd "$REPO_DIR"
EXCALIDRAW_STATE_OUT="$STATE_JSON" pi \
  --model "$MODEL" \
  --thinking medium \
  --no-builtin-tools \
  --tools excalidraw_wassette_open \
  --skill "$C4_SKILL" \
  --extension ./prototype-wassette-pi/pi-extension.ts \
  -- \
  "@$SOURCE_MMD" \
  "@$REFERENCE_PNG" \
  "@./prototype-wassette-pi/prompts/mmd-png-to-excalidraw.md"
