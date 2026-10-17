import json
import subprocess
from pathlib import Path

import pytest
from voice_agent.tasking.domain.execution_images import (
    ExecutionImageConfigurationError,
    load_execution_image_plan,
)


def write_config(workspace: Path, config: dict[str, object]) -> None:
    directory = workspace / ".pi"
    directory.mkdir()
    (directory / "gondolin.json").write_text(json.dumps(config), encoding="utf-8")


def commit_workspace(workspace: Path, message: str = "fixture") -> str:
    if not (workspace / ".git").exists():
        subprocess.run(["git", "init", "--quiet", workspace], check=True)
        subprocess.run(
            ["git", "-C", workspace, "config", "user.email", "tests@example.invalid"],
            check=True,
        )
        subprocess.run(
            ["git", "-C", workspace, "config", "user.name", "Tests"], check=True
        )
    subprocess.run(["git", "-C", workspace, "add", "--all"], check=True)
    subprocess.run(
        ["git", "-C", workspace, "commit", "--quiet", "-m", message], check=True
    )
    return subprocess.check_output(
        ["git", "-C", workspace, "rev-parse", "HEAD"], text=True
    ).strip()


def test_loads_a_deterministic_project_image_build_plan(tmp_path: Path) -> None:
    (tmp_path / "container").mkdir()
    (tmp_path / "container" / "Dockerfile").write_text("FROM scratch\n", encoding="utf-8")
    (tmp_path / "images").mkdir()
    (tmp_path / "images" / "build.json").write_text("{}\n", encoding="utf-8")
    write_config(
        tmp_path,
        {
            "image": "project-build:v1",
            "build": {
                "context": "container",
                "dockerfile": "container/Dockerfile",
                "assetConfig": "images/build.json",
                "target": "runtime",
                "contexts": {"source": "."},
            },
        },
    )

    revision = commit_workspace(tmp_path)
    plan = load_execution_image_plan(tmp_path, source_revision=revision)

    assert plan is not None
    assert plan.config_path == Path(".pi/gondolin.json")
    assert plan.image_ref == "project-build:v1"
    assert plan.context == Path("container")
    assert plan.dockerfile == Path("container/Dockerfile")
    assert plan.asset_config == Path("images/build.json")
    assert plan.target == "runtime"
    assert plan.named_contexts == (("source", Path(".")),)
    assert plan.artifact_version.startswith("v2-")
    assert plan.idempotency_key == f"image-build:{plan.artifact_version}"


def test_cache_version_ignores_files_outside_declared_build_inputs(tmp_path: Path) -> None:
    (tmp_path / "container").mkdir()
    (tmp_path / "container" / "Dockerfile").write_text("FROM scratch\n", encoding="utf-8")
    (tmp_path / "images").mkdir()
    (tmp_path / "images" / "build.json").write_text("{}\n", encoding="utf-8")
    (tmp_path / "application.txt").write_text("first\n", encoding="utf-8")
    write_config(
        tmp_path,
        {
            "image": "project-build:v1",
            "build": {
                "context": "container",
                "dockerfile": "container/Dockerfile",
                "assetConfig": "images/build.json",
            },
        },
    )
    first_revision = commit_workspace(tmp_path, "first")
    first = load_execution_image_plan(tmp_path, source_revision=first_revision)

    (tmp_path / "application.txt").write_text("second\n", encoding="utf-8")
    second_revision = commit_workspace(tmp_path, "application only")
    second = load_execution_image_plan(tmp_path, source_revision=second_revision)

    assert first is not None
    assert second is not None
    assert first.source_revision != second.source_revision
    assert first.artifact_version == second.artifact_version


@pytest.mark.parametrize("changed_path", ["container/tool", "images/build.json"])
def test_cache_version_changes_with_declared_build_inputs(
    tmp_path: Path, changed_path: str
) -> None:
    (tmp_path / "container").mkdir()
    (tmp_path / "container" / "Dockerfile").write_text("FROM scratch\n", encoding="utf-8")
    (tmp_path / "container" / "tool").write_text("first\n", encoding="utf-8")
    (tmp_path / "images").mkdir()
    (tmp_path / "images" / "build.json").write_text("{}\n", encoding="utf-8")
    write_config(
        tmp_path,
        {
            "image": "project-build:v1",
            "build": {
                "context": "container",
                "dockerfile": "container/Dockerfile",
                "assetConfig": "images/build.json",
            },
        },
    )
    first_revision = commit_workspace(tmp_path, "first")
    first = load_execution_image_plan(tmp_path, source_revision=first_revision)

    (tmp_path / changed_path).write_text("changed\n", encoding="utf-8")
    second_revision = commit_workspace(tmp_path, "build input")
    second = load_execution_image_plan(tmp_path, source_revision=second_revision)

    assert first is not None
    assert second is not None
    assert first.artifact_version != second.artifact_version


def test_cache_version_changes_with_a_named_context(tmp_path: Path) -> None:
    (tmp_path / "container").mkdir()
    (tmp_path / "container" / "Dockerfile").write_text("FROM scratch\n", encoding="utf-8")
    (tmp_path / "images").mkdir()
    (tmp_path / "images" / "build.json").write_text("{}\n", encoding="utf-8")
    (tmp_path / "application").mkdir()
    (tmp_path / "application" / "source.txt").write_text("first\n", encoding="utf-8")
    write_config(
        tmp_path,
        {
            "image": "project-build:v1",
            "build": {
                "context": "container",
                "dockerfile": "container/Dockerfile",
                "assetConfig": "images/build.json",
                "contexts": {"application": "application"},
            },
        },
    )
    first_revision = commit_workspace(tmp_path, "first")
    first = load_execution_image_plan(tmp_path, source_revision=first_revision)

    (tmp_path / "application" / "source.txt").write_text("second\n", encoding="utf-8")
    second_revision = commit_workspace(tmp_path, "named context")
    second = load_execution_image_plan(tmp_path, source_revision=second_revision)

    assert first is not None
    assert second is not None
    assert first.artifact_version != second.artifact_version


@pytest.mark.parametrize(
    "field,value",
    [
        ("context", "../outside"),
        ("dockerfile", "/tmp/Dockerfile"),
        ("assetConfig", "../../asset.json"),
    ],
)
def test_rejects_build_paths_outside_the_workspace(
    tmp_path: Path, field: str, value: str
) -> None:
    build = {
        "context": ".",
        "dockerfile": "Dockerfile",
        "assetConfig": "build.json",
    }
    build[field] = value
    write_config(tmp_path, {"image": "project:v1", "build": build})

    with pytest.raises(ExecutionImageConfigurationError, match=field):
        load_execution_image_plan(tmp_path, source_revision="abc123")


def test_requires_build_contract_for_a_project_image(tmp_path: Path) -> None:
    write_config(tmp_path, {"image": "project:v1"})

    with pytest.raises(ExecutionImageConfigurationError, match="build"):
        load_execution_image_plan(tmp_path, source_revision="abc123")


def test_loads_an_explicit_workload_image_declaration(tmp_path: Path) -> None:
    (tmp_path / "workload").mkdir()
    (tmp_path / "workload" / "Dockerfile").write_text("FROM scratch\n", encoding="utf-8")
    (tmp_path / "workload" / "assets.json").write_text("{}\n", encoding="utf-8")
    config_path = Path("workload/gondolin.json")
    (tmp_path / config_path).write_text(
        json.dumps({
            "image": "digital-twin-ingest:v1",
            "build": {
                "context": "workload",
                "dockerfile": "workload/Dockerfile",
                "assetConfig": "workload/assets.json",
                "publish": True,
            },
        }),
        encoding="utf-8",
    )
    revision = commit_workspace(tmp_path)

    plan = load_execution_image_plan(
        tmp_path,
        source_revision=revision,
        config_path=config_path,
    )

    assert plan is not None
    assert plan.config_path == config_path
    assert plan.image_ref == "digital-twin-ingest:v1"
