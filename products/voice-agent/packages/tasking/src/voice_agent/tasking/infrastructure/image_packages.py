"""Gitea Generic Package adapter for immutable execution-image artifacts."""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class GiteaImagePackages:
    endpoint: str
    owner: str
    token: str

    def _url(self, *, package: str, version: str, filename: str) -> str:
        owner, package, version, filename = (
            quote(part, safe="._-") for part in (self.owner, package, version, filename)
        )
        return (
            f"{self.endpoint.rstrip('/')}/api/packages/{owner}/generic/"
            f"{package}/{version}/{filename}"
        )

    def upload(self, source: Path, *, package: str, version: str) -> str:
        url = self._url(package=package, version=version, filename=source.name)
        with source.open("rb") as body:
            request = Request(
                url,
                data=cast(Any, body),
                headers={
                    "Authorization": f"token {self.token}",
                    "Content-Length": str(source.stat().st_size),
                    "Content-Type": "application/octet-stream",
                },
                method="PUT",
            )
            with urlopen(request, timeout=60):
                pass
        return url

    def download(self, destination: Path, *, package: str, version: str, filename: str) -> str:
        url = self._url(package=package, version=version, filename=filename)
        request = Request(url, headers={"Authorization": f"token {self.token}"})
        temporary = destination.with_suffix(destination.suffix + ".part")
        with urlopen(request, timeout=60) as response, temporary.open("wb") as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)
        temporary.replace(destination)
        return url

    def try_manifest(self, *, package: str, version: str) -> dict[str, Any] | None:
        url = self._url(package=package, version=version, filename="manifest.json")
        request = Request(url, headers={"Authorization": f"token {self.token}"})
        try:
            with urlopen(request, timeout=60) as response:
                value = json.loads(response.read())
        except HTTPError as error:
            if error.code == 404:
                return None
            raise
        if not isinstance(value, dict):
            raise TypeError("execution-image manifest must be a JSON object")
        return value
