#!/usr/bin/env bash
set -euo pipefail

runtime_dir="$HOME/Library/Application Support/PipecatEdge"
export HOME="$runtime_dir/runtime-home"
mkdir -p "$HOME"
chmod 700 "$HOME"
cd "$runtime_dir/server"
export PYTHONPATH="$runtime_dir/server/src"
exec /opt/homebrew/bin/uv run --env-file worker.env python -m voice_agent.tasking.workers.pi_worker
