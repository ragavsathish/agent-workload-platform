#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
EXCALIDRAW_REPO="$ROOT_DIR/repos/excalidraw-mcp"
LAYOUT_REPO="$ROOT_DIR/repos/mermaid-to-excalidraw"

export MERMAID_EXCALIDRAW_REPO="$LAYOUT_REPO"

echo "Installing browser-layout adapter dependencies"
if command -v yarn >/dev/null 2>&1; then
  yarn --cwd "$LAYOUT_REPO" install --frozen-lockfile --ignore-scripts
elif command -v corepack >/dev/null 2>&1; then
  corepack yarn --cwd "$LAYOUT_REPO" install --frozen-lockfile --ignore-scripts
else
  npx --yes yarn@1.22.22 --cwd "$LAYOUT_REPO" install --frozen-lockfile --ignore-scripts
fi

exec "$EXCALIDRAW_REPO/prototype-wassette-pi/setup.sh"
