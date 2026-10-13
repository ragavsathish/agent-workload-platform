"""Install this application's schema after Absurd has initialized Postgres."""

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
    ddl = (Path(__file__).resolve().parents[4] / "migrations" / "001_tasking.sql").read_text()
    with psycopg.connect(settings.database_url) as conn:
        conn.execute(sql.SQL(cast(LiteralString, ddl)))
    print("Installed voice task proposal schema")


if __name__ == "__main__":
    main()
