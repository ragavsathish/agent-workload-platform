#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root/apps/gateway"
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"

if ! uv run dotenv -f ../../deploy/.env run -- sh -c 'ABSURD_DATABASE_URL="$DATABASE_URL" uvx absurdctl schema-version' >/dev/null 2>&1; then
  uv run dotenv -f ../../deploy/.env run -- sh -c 'ABSURD_DATABASE_URL="$DATABASE_URL" uvx absurdctl init'
fi
if ! uv run dotenv -f ../../deploy/.env run -- sh -c 'ABSURD_DATABASE_URL="$DATABASE_URL" uvx absurdctl list-queues' | grep -Eq '(^|[[:space:]])agents($|[[:space:]])'; then
  uv run dotenv -f ../../deploy/.env run -- sh -c 'ABSURD_DATABASE_URL="$DATABASE_URL" uvx absurdctl create-queue "${ABSURD_QUEUE:-agents}"'
fi
PYTHONPATH=../../packages/tasking/src uv run --env-file ../../deploy/.env python -m voice_agent.tasking.infrastructure.schema
