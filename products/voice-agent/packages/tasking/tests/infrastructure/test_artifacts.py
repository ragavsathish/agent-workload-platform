import io
import subprocess
from pathlib import Path

import pytest
from voice_agent.tasking.infrastructure.artifacts import (
    ArtifactStore,
    validate_workspace_name,
)
from voice_agent.tasking.infrastructure.ensure_execution_image import _workflow_ref


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
        store._parse_source_uri(
            f"s3://other-bucket/workspaces/project/sources/{digest}.bundle"
        )


def test_scratch_root_is_not_documents(tmp_path: Path) -> None:
    scratch = tmp_path / ".local" / "share" / "agent-workload-platform" / "workspaces"
    assert "Documents" not in scratch.parts


def test_workspace_bundle_preserves_source_branch(tmp_path: Path) -> None:
    repository = tmp_path / "source"
    repository.mkdir()
    subprocess.run(["git", "-C", str(repository), "init", "-q", "-b", "feature/dev-vm"], check=True)
    subprocess.run(["git", "-C", str(repository), "config", "user.name", "Test"], check=True)
    subprocess.run(["git", "-C", str(repository), "config", "user.email", "test@example.invalid"], check=True)
    (repository / "README.md").write_text("source snapshot\n")
    subprocess.run(["git", "-C", str(repository), "add", "README.md"], check=True)
    subprocess.run(["git", "-C", str(repository), "commit", "-qm", "snapshot"], check=True)

    objects: dict[str, bytes] = {}

    class Client:
        def put_object(self, *, Key: str, Body: bytes, **_: object) -> None:
            objects[Key] = Body

        def download_fileobj(self, _bucket: str, key: str, output: io.BufferedWriter) -> None:
            output.write(objects[key])

    store = object.__new__(ArtifactStore)
    store.bucket = "test-bucket"
    store.client = Client()
    uri = store.publish_workspace("source", repository)
    with store.materialize_workspace(uri, tmp_path / "scratch") as workspace:
        assert _workflow_ref(workspace) == "refs/heads/feature/dev-vm"
        assert (workspace / "README.md").read_text() == "source snapshot\n"
