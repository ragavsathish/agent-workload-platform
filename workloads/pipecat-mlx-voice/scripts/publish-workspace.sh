#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workspace="${1:?usage: publish-workspace.sh WORKSPACE_ID REPOSITORY}"
repository="${2:?usage: publish-workspace.sh WORKSPACE_ID REPOSITORY}"
cd "$root/server"
exec uv run --env-file .env python -m orchestrator.publish_workspace "$workspace" "$repository"
