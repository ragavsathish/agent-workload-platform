"""Calculate the deterministic artifact hash used by the native Swift broker."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path


def artifact_hash(root: Path) -> str:
    root = root.absolute()
    if root.is_symlink() or not root.exists():
        raise ValueError("artifact must exist and must not be a symbolic link")
    descendants = [] if root.is_file() else list(root.rglob("*"))
    if any(path.is_symlink() for path in descendants):
        raise ValueError("symbolic links are forbidden inside model artifacts")
    files = [root] if root.is_file() else sorted(path for path in descendants if path.is_file())
    digest = hashlib.sha256()
    for path in files:
        if path.is_symlink():
            raise ValueError("symbolic links are forbidden inside model artifacts")
        relative = "/" + path.relative_to(root.parent).as_posix()
        digest.update(relative.encode())
        digest.update(b"\0")
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("artifact", type=Path)
    args = parser.parse_args()
    print(artifact_hash(args.artifact))


if __name__ == "__main__":
    main()
