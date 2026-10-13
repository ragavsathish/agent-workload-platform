from pathlib import Path

import pytest

from voice_agent.tasking.domain.workspaces import resolve_workspace


def test_workspace_must_be_beneath_an_allowed_root(tmp_path: Path) -> None:
    allowed = tmp_path / "allowed"
    project = allowed / "project"
    outside = tmp_path / "outside"
    project.mkdir(parents=True)
    outside.mkdir()

    assert resolve_workspace(str(project), (allowed.resolve(),)) == project.resolve()
    with pytest.raises(ValueError, match="outside"):
        resolve_workspace(str(outside), (allowed.resolve(),))
