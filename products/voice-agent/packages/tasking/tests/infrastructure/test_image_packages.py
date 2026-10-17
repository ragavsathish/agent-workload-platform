from pathlib import Path
from typing import Any, cast
from urllib.error import HTTPError
from urllib.request import Request

from voice_agent.tasking.infrastructure.image_packages import GiteaImagePackages


def test_upload_uses_the_builder_package_capability(tmp_path: Path, monkeypatch) -> None:
    artifact = tmp_path / "image-assets.tar.gz"
    artifact.write_bytes(b"assets")
    observed: list[Request] = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

    def urlopen(request: Request, timeout: int):
        observed.append(request)
        assert timeout == 60
        return Response()

    monkeypatch.setattr("voice_agent.tasking.infrastructure.image_packages.urlopen", urlopen)
    packages = GiteaImagePackages(
        endpoint="http://gitea.local/",
        owner="image-builder",
        token="secret-token",
    )

    location = packages.upload(artifact, package="execution-images", version="commit-digest")

    assert location == (
        "http://gitea.local/api/packages/image-builder/generic/"
        "execution-images/commit-digest/image-assets.tar.gz"
    )
    assert observed[0].method == "PUT"
    assert observed[0].headers["Authorization"] == "token secret-token"
    assert observed[0].headers["Content-length"] == "6"


def test_optional_manifest_distinguishes_cache_miss(monkeypatch) -> None:
    def missing(request: Request, timeout: int):
        raise HTTPError(request.full_url, 404, "missing", cast(Any, {}), None)

    monkeypatch.setattr("voice_agent.tasking.infrastructure.image_packages.urlopen", missing)
    packages = GiteaImagePackages("http://gitea.local", "image-builder", "token")

    assert packages.try_manifest(package="execution-images", version="v2-missing") is None
