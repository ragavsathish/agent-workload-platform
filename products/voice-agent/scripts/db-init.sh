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

habitat_password="$(<"$root/deploy/secrets/habitat-database-password")"
HABITAT_DB_PASSWORD="$habitat_password" \
  uv run dotenv -f ../../deploy/.env run -- sh -c \
  'psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --set habitat_password="$HABITAT_DB_PASSWORD"' <<'SQL'
SELECT format(
  'CREATE ROLE habitat_operator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
  :'habitat_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'habitat_operator') \gexec
SELECT format('ALTER ROLE habitat_operator PASSWORD %L', :'habitat_password') \gexec
GRANT CONNECT ON DATABASE voice_agents TO habitat_operator;
GRANT USAGE ON SCHEMA absurd TO habitat_operator;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA absurd TO habitat_operator;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA absurd TO habitat_operator;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA absurd TO habitat_operator;
ALTER DEFAULT PRIVILEGES FOR ROLE voice_agents IN SCHEMA absurd
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO habitat_operator;
ALTER DEFAULT PRIVILEGES FOR ROLE voice_agents IN SCHEMA absurd
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO habitat_operator;
ALTER DEFAULT PRIVILEGES FOR ROLE voice_agents IN SCHEMA absurd
  GRANT EXECUTE ON FUNCTIONS TO habitat_operator;
SQL
