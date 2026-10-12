#!/usr/bin/env bash
set -euo pipefail

runtime_dir="$HOME/Library/Application Support/PipecatEdge"
export HOME="$runtime_dir/runtime-home"
mkdir -p "$HOME"
chmod 700 "$HOME"
cd "$runtime_dir/server"
exec /opt/homebrew/bin/uv run --env-file worker.env python -m orchestrator.worker
