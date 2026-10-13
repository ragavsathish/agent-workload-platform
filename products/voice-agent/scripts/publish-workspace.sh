#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workspace="${1:?usage: publish-workspace.sh WORKSPACE_ID REPOSITORY}"
repository="${2:?usage: publish-workspace.sh WORKSPACE_ID REPOSITORY}"
cd "$root/apps/gateway"
export PYTHONPATH="$root/apps/gateway/src:$root/packages/tasking/src"
exec uv run --env-file ../../deploy/.env python -m voice_gateway.publish_workspace "$workspace" "$repository"
