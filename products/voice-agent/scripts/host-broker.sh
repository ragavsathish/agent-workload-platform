#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir/server"
export PYTHONPATH="$repo_dir/server/src"
exec /opt/homebrew/bin/uv run python -m voice_agent.speech.presentation.http
