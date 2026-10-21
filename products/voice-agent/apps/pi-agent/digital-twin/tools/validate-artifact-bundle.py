#!/usr/bin/env python3
"""Validate that a DVC artifact bundle exactly matches its declared file digests."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path, PurePosixPath


def fail(message: str) -> None:
    raise SystemExit(f"artifact bundle invalid: {message}")


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: validate-artifact-bundle.py ARTIFACT_DIRECTORY")

    root = Path(sys.argv[1]).resolve()
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file():
        fail("manifest.json is missing")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    declared: dict[str, str] = {}
    for entry in manifest.get("contents", []):
        raw_path = entry.get("path")
        if not isinstance(raw_path, str):
            fail("every content entry needs a string path")
        relative = PurePosixPath(raw_path)
        if relative.is_absolute() or ".." in relative.parts or raw_path == "manifest.json":
            fail(f"unsafe content path: {raw_path}")
        if raw_path in declared:
            fail(f"duplicate content path: {raw_path}")
        declared[raw_path] = entry.get("sha256", "")

    actual = {
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if path.is_file() and path != manifest_path
    }
    if actual != set(declared):
        fail(
            f"manifest/file mismatch; undeclared={sorted(actual - set(declared))}, "
            f"missing={sorted(set(declared) - actual)}"
        )

    for relative_path, expected_digest in declared.items():
        path = root / relative_path
        if path.is_symlink():
            fail(f"symlinks are not allowed: {relative_path}")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != expected_digest:
            fail(f"SHA-256 mismatch: {relative_path}")

    print(f"Validated {len(declared)} artifact file(s) in {root}")


if __name__ == "__main__":
    main()
