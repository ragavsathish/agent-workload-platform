#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$repo_dir/scripts/edge-warm-models.sh" >/dev/null
cd "$repo_dir"
exec uv run --project apps/broker python scripts/benchmark_mlx.py "$@"
