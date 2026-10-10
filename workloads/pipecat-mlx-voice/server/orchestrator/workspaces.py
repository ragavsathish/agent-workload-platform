"""Workspace boundary checks."""

from pathlib import Path


def resolve_workspace(requested: str, roots: tuple[Path, ...]) -> Path:
    candidate = Path(requested).expanduser().resolve(strict=True)
    if not candidate.is_dir():
        raise ValueError("workspace must be a directory")
    if not any(candidate == root or candidate.is_relative_to(root) for root in roots):
        raise ValueError("workspace is outside the configured roots")
    return candidate
