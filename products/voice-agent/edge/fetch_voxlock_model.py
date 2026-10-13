"""Fetch the exact VoxLock model artifacts used by the edge image."""

from __future__ import annotations

import hashlib
import json
import sys
import urllib.request
from pathlib import Path

MODEL_REPOSITORY = "arbazsiddiqui/voxlock"
MODEL_REVISION = "a50f4e1d109301d4b6f61dec57ebb1a61e7d8f03"
MODEL_FILES = {
    "enroll.onnx": "86645cba23f207def0b31a6e74a615d3b7a813b4fdf957c53b3af2905ba2ffd3",
    "chunk_int8.onnx": "f0d2b0aaf95affe8894ea008d0105be4f5f5354f7244835534c31b1a7dd4699a",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch_model(destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    for name, expected_digest in MODEL_FILES.items():
        target = destination / name
        url = (
            f"https://huggingface.co/{MODEL_REPOSITORY}/resolve/"
            f"{MODEL_REVISION}/onnx/{name}"
        )
        temporary = target.with_suffix(target.suffix + ".part")
        urllib.request.urlretrieve(url, temporary)
        actual_digest = sha256(temporary)
        if actual_digest != expected_digest:
            temporary.unlink(missing_ok=True)
            raise RuntimeError(f"VoxLock model digest mismatch for {name}")
        temporary.replace(target)

    provenance = {
        "license": "Apache-2.0",
        "repository": MODEL_REPOSITORY,
        "revision": MODEL_REVISION,
        "files": MODEL_FILES,
    }
    (destination / "provenance.json").write_text(
        json.dumps(provenance, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    fetch_model(Path(sys.argv[1]))
