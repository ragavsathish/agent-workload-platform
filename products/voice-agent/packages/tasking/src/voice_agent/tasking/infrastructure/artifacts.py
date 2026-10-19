"""S3-compatible adapter for immutable workspaces and task results."""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import boto3
from botocore.client import Config

_WORKSPACE_NAME = re.compile(r"[a-z0-9][a-z0-9._-]{0,127}")
_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"


def validate_workspace_name(name: str, allowed: tuple[str, ...]) -> str:
    if not _WORKSPACE_NAME.fullmatch(name):
        raise ValueError("workspace must be a lowercase logical name")
    if name not in allowed:
        raise ValueError("workspace is not allowed")
    return name


class ArtifactStore:
    def __init__(
        self,
        *,
        endpoint_url: str,
        bucket: str,
        access_key: str,
        secret_key: str,
    ) -> None:
        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name="us-east-1",
            config=Config(
                s3={"addressing_style": "path"},
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
            ),
        )

    def publish_workspace(self, name: str, repository: Path) -> str:
        root = Path(
            subprocess.check_output(
                ["git", "-C", str(repository), "rev-parse", "--show-toplevel"], text=True
            ).strip()
        )
        commit = subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "HEAD"], text=True
        ).strip()
        branch_ref = subprocess.check_output(
            ["git", "-C", str(root), "symbolic-ref", "--quiet", "HEAD"], text=True
        ).strip()
        with tempfile.TemporaryDirectory(prefix="workspace-publish-") as temporary:
            bundle = Path(temporary) / "source.bundle"
            subprocess.run(
                ["git", "-C", str(root), "bundle", "create", str(bundle), branch_ref],
                check=True,
            )
            payload = bundle.read_bytes()
        digest = hashlib.sha256(payload).hexdigest()
        key = f"workspaces/{name}/sources/{digest}.bundle"
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=payload,
            ContentType="application/x-git-bundle",
            Metadata={"sha256": digest, "commit": commit},
        )
        pointer = json.dumps(
            {"workspace": name, "source_key": key, "sha256": digest, "commit": commit},
            sort_keys=True,
        ).encode()
        self.client.put_object(
            Bucket=self.bucket,
            Key=f"workspaces/{name}/current.json",
            Body=pointer,
            ContentType="application/json",
        )
        return f"s3://{self.bucket}/{key}"

    def resolve_workspace(self, name: str, allowed: tuple[str, ...]) -> str:
        validate_workspace_name(name, allowed)
        response = self.client.get_object(
            Bucket=self.bucket, Key=f"workspaces/{name}/current.json"
        )
        pointer = json.loads(response["Body"].read())
        key = str(pointer["source_key"])
        digest = str(pointer["sha256"])
        expected = f"workspaces/{name}/sources/{digest}.bundle"
        if key != expected or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("workspace pointer is invalid")
        return f"s3://{self.bucket}/{key}"

    def _parse_source_uri(self, uri: str) -> tuple[str, str]:
        parsed = urlparse(uri)
        key = parsed.path.lstrip("/")
        match = re.fullmatch(
            r"workspaces/[a-z0-9][a-z0-9._-]{0,127}/sources/([0-9a-f]{64})\.bundle",
            key,
        )
        if parsed.scheme != "s3" or parsed.netloc != self.bucket or not match:
            raise ValueError("workspace artifact URI is invalid")
        return key, match.group(1)

    @contextmanager
    def materialize_workspace(self, uri: str, scratch_root: Path) -> Iterator[Path]:
        key, expected_digest = self._parse_source_uri(uri)
        scratch_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(scratch_root, 0o700)
        with tempfile.TemporaryDirectory(prefix="task-", dir=scratch_root) as temporary:
            task_root = Path(temporary)
            bundle = task_root / "source.bundle"
            with bundle.open("wb") as output:
                self.client.download_fileobj(self.bucket, key, output)
            actual_digest = hashlib.sha256(bundle.read_bytes()).hexdigest()
            if actual_digest != expected_digest:
                raise ValueError("workspace artifact digest mismatch")
            workspace = task_root / "workspace"
            workspace.mkdir(mode=0o700)
            subprocess.run(["git", "-C", str(workspace), "init", "--quiet"], check=True)
            bundle_heads = subprocess.check_output(
                ["git", "bundle", "list-heads", str(bundle)], text=True
            ).splitlines()
            branch_refs = [
                line.split(" ", 1)[1]
                for line in bundle_heads
                if " " in line and line.split(" ", 1)[1].startswith("refs/heads/")
            ]
            if len(branch_refs) == 1 and len(bundle_heads) == 1:
                branch_ref = branch_refs[0]
                subprocess.run(
                    ["git", "-C", str(workspace), "fetch", "--quiet", str(bundle),
                     f"{branch_ref}:{branch_ref}"],
                    check=True,
                )
                subprocess.run(
                    ["git", "-C", str(workspace), "checkout", "--quiet",
                     branch_ref.removeprefix("refs/heads/")],
                    check=True,
                )
            elif len(bundle_heads) == 1 and bundle_heads[0].endswith(" HEAD"):
                # Snapshots published before branch-bearing bundles remain readable.
                subprocess.run(
                    ["git", "-C", str(workspace), "fetch", "--quiet", str(bundle), "HEAD"],
                    check=True,
                )
                subprocess.run(
                    ["git", "-C", str(workspace), "checkout", "--quiet", "--detach", "FETCH_HEAD"],
                    check=True,
                )
            else:
                raise ValueError("workspace bundle must contain exactly one source ref")
            yield workspace

    def capture_result(
        self,
        *,
        task_id: str,
        workspace: Path,
        execution: dict[str, Any],
        max_bytes: int,
    ) -> dict[str, str]:
        subprocess.run(
            ["git", "-C", str(workspace), "add", "--intent-to-add", "--all"],
            check=True,
        )
        patch = subprocess.check_output(
            ["git", "-C", str(workspace), "diff", "--binary", "HEAD"]
        )
        if len(patch) > max_bytes:
            raise ValueError("task patch exceeds WORKER_MAX_ARTIFACT_BYTES")
        status = subprocess.check_output(
            ["git", "-C", str(workspace), "status", "--short"], text=True
        ).encode()
        result = json.dumps(execution, sort_keys=True, default=str).encode()
        prefix = f"tasks/{task_id}"
        objects = {
            "patch": (f"{prefix}/changes.patch", patch, "text/x-diff"),
            "status": (f"{prefix}/status.txt", status, "text/plain"),
            "execution": (f"{prefix}/execution.json", result, "application/json"),
        }
        uris: dict[str, str] = {}
        for label, (key, body, content_type) in objects.items():
            self.client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=body,
                ContentType=content_type,
            )
            uris[label] = f"s3://{self.bucket}/{key}"
        return uris

    def put_song(self, *, generation_id: str, audio: bytes) -> dict[str, str]:
        """Store one immutable, browser-friendly song artifact."""
        if not re.fullmatch(_UUID, generation_id):
            raise ValueError("song generation ID is invalid")
        if not audio:
            raise ValueError("song audio cannot be empty")
        digest = hashlib.sha256(audio).hexdigest()
        key = f"songs/{generation_id}/{digest}.m4a"
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=audio,
            ContentType="audio/mp4",
            Metadata={"sha256": digest},
        )
        return {
            "audio": f"s3://{self.bucket}/{key}",
            "sha256": digest,
        }

    def get_song(self, uri: str, *, max_bytes: int = 32 * 1024 * 1024) -> bytes:
        parsed = urlparse(uri)
        key = parsed.path.lstrip("/")
        if (
            parsed.scheme != "s3"
            or parsed.netloc != self.bucket
            or re.fullmatch(rf"songs/{_UUID}/[0-9a-f]{{64}}\.m4a", key)
            is None
        ):
            raise ValueError("song artifact URI is invalid")
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        content_length = int(response.get("ContentLength", 0))
        if content_length <= 0 or content_length > max_bytes:
            raise ValueError("song artifact is outside its allowed size")
        audio = response["Body"].read(max_bytes + 1)
        if len(audio) != content_length or len(audio) > max_bytes:
            raise ValueError("song artifact read was incomplete")
        return audio
