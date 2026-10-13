#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$repo_dir/scripts/edge-warm-models.sh" >/dev/null
cd "$repo_dir/server"
exec uv run python ../scripts/benchmark_mlx.py "$@"
