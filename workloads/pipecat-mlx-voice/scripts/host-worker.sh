#!/usr/bin/env bash
set -euo pipefail

runtime_dir="$HOME/Library/Application Support/PipecatEdge"
cd "$runtime_dir/server"
exec /opt/homebrew/bin/uv run --env-file worker.env python -m orchestrator.worker
