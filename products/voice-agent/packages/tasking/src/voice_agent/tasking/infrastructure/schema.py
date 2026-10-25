"""Install this application's proposal and song schemas."""

from pathlib import Path
from typing import LiteralString, cast

import psycopg
from dotenv import load_dotenv
from psycopg import sql

from voice_agent.tasking.infrastructure.config import Settings


def main() -> None:
    load_dotenv(override=True)
    settings = Settings.from_env()
    if not settings.database_url:
        raise SystemExit("DATABASE_URL is required")
    migrations = Path(__file__).resolve().parents[4] / "migrations"
    with psycopg.connect(settings.database_url) as conn:
        for migration in sorted(migrations.glob("*.sql")):
            conn.execute(sql.SQL(cast(LiteralString, migration.read_text())))
    print("Installed voice task schema")


if __name__ == "__main__":
    main()
