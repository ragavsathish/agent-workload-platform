#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REQUEST=${1:-}
ARTIFACT_DIR=${2:-"$SCRIPT_DIR/artifacts/qwen-request"}
MODEL=${PI_C4_MODEL:-lmstudio/qwen/qwen3.8-27b}
C4_SKILL=${PI_C4_SKILL:-/Users/sathish.narayanan/.codex/skills/c4-diagrams}

if [[ -z $REQUEST ]]; then
  echo "usage: $0 'architecture request' [artifact-directory]" >&2
  echo "       $0 path/to/request.txt [artifact-directory]" >&2
  exit 2
fi

mkdir -p "$ARTIFACT_DIR"
RAW_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/qwen-c4.XXXXXX")
trap 'rm -f "$RAW_OUTPUT"' EXIT
SOURCE_MMD="$ARTIFACT_DIR/request.mmd"

echo "[1/2] Asking Qwen to model the request as C4 Mermaid"
if [[ -f $REQUEST ]]; then
  pi --model "$MODEL" --thinking off --no-tools --no-session --skill "$C4_SKILL" \
    --system-prompt "You are a C4 architecture modeling worker. Follow the loaded skill and output contract exactly." \
    --no-context-files --no-extensions -p -- \
    "@$REQUEST" "@$SCRIPT_DIR/prompts/request-to-c4-mermaid.md" "/no_think" >"$RAW_OUTPUT"
else
  pi --model "$MODEL" --thinking off --no-tools --no-session --skill "$C4_SKILL" \
    --system-prompt "You are a C4 architecture modeling worker. Follow the loaded skill and output contract exactly." \
    --no-context-files --no-extensions -p -- \
    "$REQUEST" "@$SCRIPT_DIR/prompts/request-to-c4-mermaid.md" "/no_think" >"$RAW_OUTPUT"
fi

node "$SCRIPT_DIR/extract-c4-mermaid.mjs" "$RAW_OUTPUT" "$SOURCE_MMD"
mmdc --input "$SOURCE_MMD" --output "$ARTIFACT_DIR/request.mermaid.png" --quiet

echo "[2/2] Building the editable Excalidraw scene through Qwen vision and Wassette"
"$SCRIPT_DIR/run-qwen-c4-workflow.sh" "$SOURCE_MMD" "$ARTIFACT_DIR"
