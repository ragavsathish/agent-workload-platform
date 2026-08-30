#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MONOREPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
REPO_DIR=${EXCALIDRAW_MCP_REPO:-"$MONOREPO_ROOT/apps/excalidraw-mcp"}
CORE_DIR="$SCRIPT_DIR/core"
PIPELINE_COMPONENTS_DIR="$SCRIPT_DIR/components"
COMPONENT_DIR="$SCRIPT_DIR/.wassette-components"
LAYOUT_REPO_DIR=${MERMAID_EXCALIDRAW_REPO:-"$MONOREPO_ROOT/adapters/mermaid-to-excalidraw"}

command -v node >/dev/null || { echo "node is required" >&2; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm is required" >&2; exit 1; }
command -v wassette >/dev/null || { echo "wassette is required" >&2; exit 1; }
[ -f "$LAYOUT_REPO_DIR/scripts/build-playwright-gondolin.sh" ] || {
  echo "Missing Mermaid-to-Excalidraw package at $LAYOUT_REPO_DIR" >&2
  echo "Set MERMAID_EXCALIDRAW_REPO to its path" >&2
  exit 1
}

echo "[0/8] Installing the browser-layout adapter dependencies"
if command -v yarn >/dev/null 2>&1; then
  yarn --cwd "$LAYOUT_REPO_DIR" install --frozen-lockfile --ignore-scripts
elif command -v corepack >/dev/null 2>&1; then
  corepack yarn --cwd "$LAYOUT_REPO_DIR" install --frozen-lockfile --ignore-scripts
else
  npx --yes yarn@1.22.22 --cwd "$LAYOUT_REPO_DIR" install --frozen-lockfile --ignore-scripts
fi

echo "[1/8] Installing the cloned Excalidraw MCP dependencies"
pnpm --dir "$REPO_DIR" install --ignore-scripts --frozen-lockfile

echo "[2/8] Building the cloned Excalidraw MCP App and server"
pnpm --dir "$REPO_DIR" run build

echo "[3/8] Installing the prototype component toolchain"
npm --prefix "$SCRIPT_DIR" ci --ignore-scripts
npm --prefix "$CORE_DIR" ci --ignore-scripts
npm --prefix "$PIPELINE_COMPONENTS_DIR" ci --ignore-scripts

echo "[4/8] Building the legacy checkpoint component"
npm --prefix "$CORE_DIR" run build

echo "[5/8] Building the C4 compiler and Excalidraw policy components"
npm --prefix "$PIPELINE_COMPONENTS_DIR" run build

echo "[6/8] Loading all components into Wassette"
mkdir -p "$COMPONENT_DIR"
wassette component load "file://$CORE_DIR/dist/excalidraw-core.wasm" --component-dir "$COMPONENT_DIR"
wassette component load "file://$PIPELINE_COMPONENTS_DIR/dist/c4-compiler.wasm" --component-dir "$COMPONENT_DIR"
wassette component load "file://$PIPELINE_COMPONENTS_DIR/dist/excalidraw-policy.wasm" --component-dir "$COMPONENT_DIR"

echo "[7/8] Building the thin MCP-App host"
npm --prefix "$SCRIPT_DIR" run build:host

echo "[8/8] Building the Playwright OCI rootfs and Gondolin image"
if [ "${SKIP_GONDOLIN_BUILD:-0}" = "1" ]; then
  echo "Skipped because SKIP_GONDOLIN_BUILD=1"
else
  sh "$LAYOUT_REPO_DIR/scripts/build-playwright-gondolin.sh"
fi

echo
echo "Ready. Start Pi from the monorepo root with:"
echo "  pi -e ./workloads/c4-excalidraw/pi-extension.ts"
echo
echo "For C4 Mermaid rendering, also load the C4 skill:"
echo "  pi --skill ~/.codex/skills/c4-diagrams -e ./workloads/c4-excalidraw/pi-extension.ts"
