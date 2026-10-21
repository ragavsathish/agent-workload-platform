"""Idempotently initialize application schemas, queues, and database roles."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import LiteralString, cast

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[2]


def absurdctl(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment["ABSURD_DATABASE_URL"] = environment["DATABASE_URL"]
    environment["PATH"] = f"/opt/homebrew/opt/libpq/bin:{environment['PATH']}"
    result = subprocess.run(
        ["uvx", "absurdctl", *args],
        check=False,
        text=True,
        capture_output=True,
        env=environment,
        cwd=ROOT / "apps/gateway",
    )
    if check and result.returncode != 0:
        raise SystemExit(result.stderr.strip() or result.stdout.strip())
    return result


def main() -> None:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    if absurdctl("schema-version", check=False).returncode != 0:
        absurdctl("init")
    existing_queues = set(absurdctl("list-queues").stdout.split())
    for queue in os.environ.get("ABSURD_QUEUE", "agents").split():
        if queue not in existing_queues:
            absurdctl("create-queue", queue)

    migration = (ROOT / "packages/tasking/migrations/001_tasking.sql").read_text(encoding="utf-8")
    habitat_password = (
        (ROOT / "deploy/secrets/habitat-database-password").read_text(encoding="utf-8").strip()
    )
    with psycopg.connect(database_url) as connection:
        connection.execute(sql.SQL(cast(LiteralString, migration)))
        exists = connection.execute(
            "SELECT 1 FROM pg_roles WHERE rolname = 'habitat_operator'"
        ).fetchone()
        password = sql.Literal(habitat_password)
        if not exists:
            connection.execute(
                sql.SQL(
                    "CREATE ROLE habitat_operator LOGIN NOSUPERUSER NOCREATEDB "
                    "NOCREATEROLE NOREPLICATION PASSWORD {}"
                ).format(password)
            )
        else:
            connection.execute(sql.SQL("ALTER ROLE habitat_operator PASSWORD {}").format(password))
        connection.execute("GRANT CONNECT ON DATABASE voice_agents TO habitat_operator")
        connection.execute("GRANT USAGE ON SCHEMA absurd TO habitat_operator")
        connection.execute(
            "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES "
            "IN SCHEMA absurd TO habitat_operator"
        )
        connection.execute(
            "GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA absurd TO habitat_operator"
        )
        connection.execute("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA absurd TO habitat_operator")
        connection.execute(
            "ALTER DEFAULT PRIVILEGES FOR ROLE voice_agents IN SCHEMA absurd "
            "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO habitat_operator"
        )
        connection.execute(
            "ALTER DEFAULT PRIVILEGES FOR ROLE voice_agents IN SCHEMA absurd "
            "GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO habitat_operator"
        )
        connection.execute(
            "ALTER DEFAULT PRIVILEGES FOR ROLE voice_agents IN SCHEMA absurd "
            "GRANT EXECUTE ON FUNCTIONS TO habitat_operator"
        )
    print("Database schemas, queues, and roles are ready")


if __name__ == "__main__":
    main()
