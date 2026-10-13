from pathlib import Path

import pytest

from voice_agent.tasking.infrastructure.artifacts import ArtifactStore, validate_workspace_name


def test_workspace_name_is_logical_and_allowlisted() -> None:
    allowed = ("agent-workload-platform",)
    assert validate_workspace_name("agent-workload-platform", allowed) == allowed[0]
    with pytest.raises(ValueError, match="lowercase logical"):
        validate_workspace_name("/Users/me/Documents/project", allowed)
    with pytest.raises(ValueError, match="not allowed"):
        validate_workspace_name("another-project", allowed)


def test_source_uri_must_target_expected_bucket_and_digest() -> None:
    store = object.__new__(ArtifactStore)
    store.bucket = "agent-artifacts"
    digest = "a" * 64
    key, parsed_digest = store._parse_source_uri(
        f"s3://agent-artifacts/workspaces/project/sources/{digest}.bundle"
    )
    assert key.endswith(f"{digest}.bundle")
    assert parsed_digest == digest
    with pytest.raises(ValueError, match="invalid"):
        store._parse_source_uri(f"s3://other-bucket/workspaces/project/sources/{digest}.bundle")


def test_scratch_root_is_not_documents(tmp_path: Path) -> None:
    scratch = tmp_path / ".local" / "share" / "agent-workload-platform" / "workspaces"
    assert "Documents" not in scratch.parts


def test_result_artifact_names_are_allowlisted() -> None:
    class Body:
        def read(self) -> bytes:
            return b"diff --git a/file b/file\n"

    class Client:
        def get_object(self, **values):
            assert values == {
                "Bucket": "agent-artifacts",
                "Key": "tasks/task-1/changes.patch",
            }
            return {"Body": Body()}

    store = object.__new__(ArtifactStore)
    store.bucket = "agent-artifacts"
    store.client = Client()

    assert store.read_result_artifact(task_id="task-1", artifact="patch") == (
        "changes.patch",
        "text/x-diff",
        b"diff --git a/file b/file\n",
    )
    with pytest.raises(ValueError, match="unknown task artifact"):
        store.read_result_artifact(task_id="task-1", artifact="../../secret")
