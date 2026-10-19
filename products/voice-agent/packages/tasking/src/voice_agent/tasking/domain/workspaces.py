"""Published workspace identity and boundary rules."""

from pathlib import Path

SCRATCH_WORKSPACE = "scratch"


def is_scratch_workspace(requested: str) -> bool:
    return requested == SCRATCH_WORKSPACE


def validate_workspace_boundary(requested: str, roots: tuple[Path, ...]) -> Path:
    candidate = Path(requested).expanduser().resolve(strict=False)
    if not any(candidate == root or candidate.is_relative_to(root) for root in roots):
        raise ValueError("workspace is outside the configured roots")
    return candidate


def resolve_workspace(requested: str, roots: tuple[Path, ...]) -> Path:
    candidate = validate_workspace_boundary(requested, roots)
    try:
        candidate = candidate.resolve(strict=True)
    except FileNotFoundError as error:
        raise ValueError(
            "workspace does not exist; choose 'scratch' for a task without a repository"
        ) from error
    if not candidate.is_dir():
        raise ValueError("workspace must be a directory")
    return candidate
