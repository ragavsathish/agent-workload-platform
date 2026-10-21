"""Private benchmark evidence output."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
ARTIFACTS = ROOT / "artifacts/benchmarks"


def stamp():
    return datetime.now(UTC).strftime("%Y-%m-%dT%H%M%SZ")


def save(result: dict):
    directory = ARTIFACTS / result["id"]
    directory.mkdir(parents=True, exist_ok=False, mode=0o700)
    path = directory / "result.json"
    path.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    os.chmod(path, 0o600)
    print(f"RESULT {path}", flush=True)
    return path
