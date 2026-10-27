"""Stable hashing helpers for the public task plan representation."""

from __future__ import annotations

import hashlib
import json
from typing import Any


def plan_hash(plan: dict[str, Any]) -> str:
    canonical = json.dumps(plan, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode()).hexdigest()
