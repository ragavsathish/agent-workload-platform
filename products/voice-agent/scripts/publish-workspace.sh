#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workspace="${1:?usage: publish-workspace.sh WORKSPACE_ID REPOSITORY}"
repository="${2:?usage: publish-workspace.sh WORKSPACE_ID REPOSITORY}"
cd "$root/server"
export PYTHONPATH="$root/server/src"
exec uv run --env-file .env python -m voice_agent.tasking.presentation.publish_workspace "$workspace" "$repository"
