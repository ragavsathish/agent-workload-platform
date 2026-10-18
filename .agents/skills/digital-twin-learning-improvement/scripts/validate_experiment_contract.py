#!/usr/bin/env python3
"""Validate a bounded-autoresearch experiment contract without external packages."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


REQUIRED_FIELDS = {
    "objective",
    "baseline",
    "mutable_scope",
    "immutable_scope",
    "safety_gates",
    "operational_limits",
    "budget",
    "repetitions",
    "stop_conditions",
}


def normalized(value: object) -> str:
    return str(value).strip().lower().replace("-", "_").replace(" ", "_")


def validate(contract: object) -> list[str]:
    if not isinstance(contract, dict):
        return ["contract must be a JSON object"]

    errors: list[str] = []
    missing = sorted(REQUIRED_FIELDS - contract.keys())
    if missing:
        errors.append(f"missing required fields: {', '.join(missing)}")

    mutable = contract.get("mutable_scope")
    immutable = contract.get("immutable_scope")
    if not isinstance(mutable, list) or not mutable:
        errors.append("mutable_scope must be a non-empty array")
        mutable = []
    if not isinstance(immutable, list) or not immutable:
        errors.append("immutable_scope must be a non-empty array")
        immutable = []

    mutable_names = {normalized(item) for item in mutable}
    immutable_names = {normalized(item) for item in immutable}
    overlap = sorted(mutable_names & immutable_names)
    if overlap:
        errors.append(f"mutable_scope overlaps immutable_scope: {', '.join(overlap)}")
    if "locked_holdout" not in immutable_names:
        errors.append("immutable_scope must include locked_holdout")
    if "locked_holdout" in mutable_names:
        errors.append("locked_holdout must never be mutable")

    gates = contract.get("safety_gates")
    if not isinstance(gates, dict) or not gates:
        errors.append("safety_gates must be a non-empty object")

    limits = contract.get("operational_limits")
    if not isinstance(limits, dict) or not limits:
        errors.append("operational_limits must be a non-empty object")

    budget = contract.get("budget")
    if not isinstance(budget, dict):
        errors.append("budget must be an object")
    else:
        for field in ("max_experiments", "max_consecutive_non_improvements"):
            value = budget.get(field)
            if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                errors.append(f"budget.{field} must be a positive integer")
        wall_time = budget.get("max_wall_time")
        if not isinstance(wall_time, str) or not wall_time.strip():
            errors.append("budget.max_wall_time must be a non-empty duration string")

    for field in ("objective", "baseline", "repetitions", "stop_conditions"):
        if field in contract and contract[field] in (None, "", [], {}):
            errors.append(f"{field} must not be empty")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("contract", type=Path, help="JSON experiment contract")
    args = parser.parse_args()

    try:
        contract = json.loads(args.contract.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: cannot read contract: {exc}", file=sys.stderr)
        return 2

    errors = validate(contract)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print(f"OK: valid bounded experiment contract: {args.contract}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
