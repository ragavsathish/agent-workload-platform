#!/usr/bin/env bash
set -euo pipefail

runtime_dir="$HOME/Library/Application Support/PipecatEdge"
cd "$runtime_dir/apps/broker"
export PYTHONPATH="$runtime_dir/apps/broker/src:$runtime_dir/packages/telemetry/src"
exec /opt/homebrew/bin/uv run python -m voice_agent.speech.presentation.http
