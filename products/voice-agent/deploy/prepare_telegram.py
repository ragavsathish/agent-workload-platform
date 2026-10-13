"""Materialize the optional Telegram task-console secrets."""

from __future__ import annotations

import os
import secrets
import sys
from pathlib import Path

from dotenv import dotenv_values


def required(values: dict[str, str | None], name: str) -> str:
    value = (values.get(name) or "").strip()
    if not value or value.startswith("replace-with-"):
        raise SystemExit(f"{name} must be configured in server/.env")
    return value


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    values = dotenv_values(root / "server/.env")
    bot_token = required(values, "TELEGRAM_BOT_TOKEN")
    required(values, "TELEGRAM_CHAT_ID")
    required(values, "TELEGRAM_ALLOWED_USER_IDS")

    secrets_dir = root / "deploy/secrets"
    secrets_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    gateway_path = secrets_dir / "telegram-gateway-token"
    gateway_token = (
        gateway_path.read_text(encoding="utf-8").strip()
        if gateway_path.is_file()
        else secrets.token_urlsafe(32)
    )
    for path, value in (
        (secrets_dir / "telegram-bot-token", bot_token),
        (gateway_path, gateway_token),
    ):
        path.write_text(value + "\n", encoding="utf-8")
        os.chmod(path, 0o600)


if __name__ == "__main__":
    main()
