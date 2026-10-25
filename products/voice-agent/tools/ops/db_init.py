"""Idempotently initialize the Voice Agent application schemas."""

from __future__ import annotations

import os
from pathlib import Path
from typing import LiteralString, cast

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    with psycopg.connect(database_url) as connection:
        for migration in sorted((ROOT / "packages/tasking/migrations").glob("*.sql")):
            connection.execute(sql.SQL(cast(LiteralString, migration.read_text(encoding="utf-8"))))
    print("Voice Agent database schemas are ready")


if __name__ == "__main__":
    main()
