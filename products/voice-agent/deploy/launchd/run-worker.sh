#!/usr/bin/env bash
set -euo pipefail

runtime_dir="$HOME/Library/Application Support/PipecatEdge"
export HOME="$runtime_dir/runtime-home"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p "$HOME"
chmod 700 "$HOME"
cd "$runtime_dir/apps/worker"
export PYTHONPATH="$runtime_dir/apps/worker/src:$runtime_dir/packages/tasking/src"
exec /opt/homebrew/bin/uv run --env-file worker.env python -m voice_worker.main
