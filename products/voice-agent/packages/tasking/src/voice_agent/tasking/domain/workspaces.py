"""Published workspace identity and boundary rules."""

from pathlib import Path


def validate_workspace_boundary(requested: str, roots: tuple[Path, ...]) -> Path:
    candidate = Path(requested).expanduser().resolve(strict=False)
    if not any(candidate == root or candidate.is_relative_to(root) for root in roots):
        raise ValueError("workspace is outside the configured roots")
    return candidate


def resolve_workspace(requested: str, roots: tuple[Path, ...]) -> Path:
    candidate = validate_workspace_boundary(requested, roots)
    candidate = candidate.resolve(strict=True)
    if not candidate.is_dir():
        raise ValueError("workspace must be a directory")
    return candidate
