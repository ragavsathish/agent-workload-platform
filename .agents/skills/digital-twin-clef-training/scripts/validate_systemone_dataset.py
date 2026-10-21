#!/usr/bin/env python3
"""Validate reviewed SystemOne JSONL structure and split-isolation invariants."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


ALLOWED_SPLITS = {"train", "development", "challenge", "locked-holdout", "locked-test", "production-shadow"}
SECRET_PATTERNS = {
    "private key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "AWS access key": re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "bearer token": re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{20,}", re.IGNORECASE),
    "email address": re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
}


def normalize_state(value: str) -> str:
    return " ".join(value.casefold().split())


def validate_row(row: object, line_number: int) -> list[str]:
    prefix = f"line {line_number}"
    if not isinstance(row, dict):
        return [f"{prefix}: row must be an object"]

    errors: list[str] = []
    for field in ("id", "state", "questions", "labels", "metadata"):
        if field not in row:
            errors.append(f"{prefix}: missing {field}")

    if not isinstance(row.get("id"), str) or not row.get("id", "").strip():
        errors.append(f"{prefix}: id must be a non-empty string")
    if not isinstance(row.get("state"), str) or not row.get("state", "").strip():
        errors.append(f"{prefix}: state must be a non-empty string")

    questions = row.get("questions")
    labels = row.get("labels")
    if not isinstance(questions, dict) or not questions:
        errors.append(f"{prefix}: questions must be a non-empty object")
        questions = {}
    if not isinstance(labels, dict) or not labels:
        errors.append(f"{prefix}: labels must be a non-empty object")
        labels = {}

    for question_name, label in labels.items():
        question = questions.get(question_name)
        if not isinstance(question, dict):
            errors.append(f"{prefix}: label {question_name!r} has no matching question")
            continue
        criteria = question.get("criteria")
        if question.get("type") != "choice" or not isinstance(criteria, dict):
            errors.append(f"{prefix}: question {question_name!r} must be a choice with criteria")
            continue
        if label not in criteria:
            errors.append(f"{prefix}: label {label!r} is not legal for question {question_name!r}")

    metadata = row.get("metadata")
    if not isinstance(metadata, dict):
        errors.append(f"{prefix}: metadata must be an object")
    else:
        if metadata.get("annotationStatus") != "owner-reviewed":
            errors.append(f"{prefix}: annotationStatus must be owner-reviewed")
        if not isinstance(metadata.get("semanticFamilyId"), str) or not metadata.get("semanticFamilyId", "").strip():
            errors.append(f"{prefix}: semanticFamilyId must be a non-empty string")
        if metadata.get("split") not in ALLOWED_SPLITS:
            errors.append(f"{prefix}: split must be one of {sorted(ALLOWED_SPLITS)}")

    serialized = json.dumps(row, ensure_ascii=False)
    for name, pattern in SECRET_PATTERNS.items():
        if pattern.search(serialized):
            errors.append(f"{prefix}: possible {name} detected")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path, help="reviewed SystemOne JSONL dataset")
    args = parser.parse_args()

    errors: list[str] = []
    rows: list[tuple[int, dict]] = []
    try:
        lines = args.dataset.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        print(f"ERROR: cannot read dataset: {exc}", file=sys.stderr)
        return 2

    for line_number, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            errors.append(f"line {line_number}: invalid JSON: {exc.msg}")
            continue
        errors.extend(validate_row(row, line_number))
        if isinstance(row, dict):
            rows.append((line_number, row))

    if not rows:
        errors.append("dataset contains no rows")

    ids: dict[str, int] = {}
    family_splits: dict[str, tuple[str, int]] = {}
    state_splits: dict[str, tuple[str, int]] = {}
    for line_number, row in rows:
        row_id = row.get("id")
        if isinstance(row_id, str) and row_id:
            if row_id in ids:
                errors.append(f"line {line_number}: duplicate id first seen on line {ids[row_id]}")
            ids[row_id] = line_number

        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        family = metadata.get("semanticFamilyId")
        split = metadata.get("split")
        if isinstance(family, str) and family and isinstance(split, str):
            previous = family_splits.get(family)
            if previous and previous[0] != split:
                errors.append(
                    f"line {line_number}: semantic family crosses splits "
                    f"({previous[0]} on line {previous[1]} vs {split})"
                )
            family_splits[family] = (split, line_number)

        state = row.get("state")
        if isinstance(state, str) and state.strip() and isinstance(split, str):
            key = normalize_state(state)
            previous = state_splits.get(key)
            if previous and previous[0] != split:
                errors.append(
                    f"line {line_number}: normalized state crosses splits "
                    f"({previous[0]} on line {previous[1]} vs {split})"
                )
            state_splits[key] = (split, line_number)

    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print(
        f"OK: {len(rows)} reviewed rows, {len(family_splits)} semantic families, "
        f"no cross-split normalized duplicates"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
