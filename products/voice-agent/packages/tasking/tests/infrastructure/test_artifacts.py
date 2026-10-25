import io
import subprocess
import zipfile
from pathlib import Path

import pytest
from botocore.exceptions import ClientError
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
    with pytest.raises(ValueError, match="reserved"):
        validate_workspace_name("scratch", ("scratch",))


def test_publish_rejects_unallowlisted_workspace_before_artifact_writes(tmp_path: Path) -> None:
    writes: list[str] = []

    class Client:
        def put_object(self, *, Key: str, **_: object) -> None:
            writes.append(Key)

    store = object.__new__(ArtifactStore)
    store.bucket = "test-bucket"
    store.client = Client()

    with pytest.raises(ValueError, match="not allowed"):
        store.publish_workspace("sdft-confsft-methods-paper", tmp_path, ("approved",))

    assert writes == []


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


@pytest.mark.parametrize("branch", ["main", "feature/dev-vm"])
@pytest.mark.parametrize("persistent", [False, True])
def test_workspace_bundle_preserves_source_branch(
    tmp_path: Path, branch: str, persistent: bool
) -> None:
    repository = tmp_path / "source"
    repository.mkdir()
    subprocess.run(["git", "-C", str(repository), "init", "-q", "-b", branch], check=True)
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
    uri = store.publish_workspace("source", repository, ("source",))
    persistent_root = tmp_path / "scratch" / "task-1" if persistent else None
    with store.materialize_workspace(
        uri, tmp_path / "scratch", persistent_root=persistent_root
    ) as workspace:
        assert _workflow_ref(workspace) == f"refs/heads/{branch}"
        assert (workspace / "README.md").read_text() == "source snapshot\n"
        if persistent:
            (workspace / "result.txt").write_text("kept after restart\n")
    if persistent:
        with store.materialize_workspace(
            uri, tmp_path / "scratch", persistent_root=persistent_root
        ) as resumed:
            assert (resumed / "result.txt").read_text() == "kept after restart\n"


def test_missing_published_workspace_suggests_explicit_scratch() -> None:
    class Client:
        def get_object(self, **_):
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")

    store = object.__new__(ArtifactStore)
    store.bucket = "test-bucket"
    store.client = Client()
    with pytest.raises(ValueError, match="choose 'scratch'"):
        store.resolve_workspace("project", ("project",))


def test_scratch_result_saves_bounded_files_without_git(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "notes.txt").write_text("hello\n")
    (workspace / "nested").mkdir()
    (workspace / "nested" / "result.txt").write_text("world\n")
    (workspace / "outside-link").symlink_to(tmp_path)
    objects = {}

    class Client:
        def put_object(self, *, Key, Body, **_):
            objects[Key] = Body

    store = object.__new__(ArtifactStore)
    store.bucket = "test-bucket"
    store.client = Client()
    uris = store.capture_scratch_result(
        task_id="task-1", workspace=workspace, execution={"exit_code": 0}, max_bytes=1024
    )
    assert set(uris) == {"workspace", "execution"}
    with zipfile.ZipFile(io.BytesIO(objects["tasks/task-1/workspace.zip"])) as archive:
        assert archive.namelist() == ["nested/result.txt", "notes.txt"]
        assert archive.read("notes.txt") == b"hello\n"

    with pytest.raises(ValueError, match="exceeds WORKER_MAX_ARTIFACT_BYTES"):
        store.capture_scratch_result(
            task_id="task-2", workspace=workspace, execution={}, max_bytes=2
        )
    assert "tasks/task-2/workspace.zip" not in objects


def test_task_artifact_reads_only_bounded_known_objects() -> None:
    task_id = "11111111-1111-4111-8111-111111111111"

    class Client:
        def get_object(self, *, Bucket, Key):
            assert Bucket == "test-bucket"
            assert Key == f"tasks/{task_id}/workspace.zip"
            return {"ContentLength": 3, "Body": io.BytesIO(b"zip")}

    store = object.__new__(ArtifactStore)
    store.bucket = "test-bucket"
    store.client = Client()
    assert store.get_task_artifact(task_id=task_id, name="workspace", max_bytes=3) == (
        b"zip", "workspace.zip", "application/zip"
    )
    with pytest.raises(ValueError, match="allowed size"):
        store.get_task_artifact(task_id=task_id, name="workspace", max_bytes=2)
    with pytest.raises(ValueError, match="invalid"):
        store.get_task_artifact(task_id="../other", name="workspace", max_bytes=3)
