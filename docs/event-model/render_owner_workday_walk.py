#!/usr/bin/env python3
"""Render the tentative owner workday Structurizr wall as SVG and PNG."""

from pathlib import Path
from tempfile import TemporaryDirectory
import shutil
import subprocess


base = Path(__file__).resolve().parent
source = "owner-workday-walk.dsl"
view = "structurizr-owner-workday"


def run(*args: str) -> None:
    subprocess.run(args, check=True)


with TemporaryDirectory(prefix=".owner-workday-", dir=base) as temp_name:
    temp = Path(temp_name)
    temp.chmod(0o777)
    volume = f"{base}:/usr/local/structurizr"
    run("docker", "run", "--rm", "-v", volume, "structurizr/structurizr",
        "validate", "-workspace", f"/usr/local/structurizr/{source}")
    run("docker", "run", "--rm", "-v", volume, "structurizr/structurizr",
        "export", "-workspace", f"/usr/local/structurizr/{source}",
        "-format", "plantuml", "-output", f"/usr/local/structurizr/{temp.name}")
    for fmt in ("png", "svg"):
        run("docker", "run", "--rm", "-e", "PLANTUML_LIMIT_SIZE=16384",
            "-v", f"{temp}:/work", "plantuml/plantuml",
            f"-t{fmt}", f"/work/{view}.puml")
        shutil.copyfile(temp / f"{view}.{fmt}", base / f"owner-workday-walk.{fmt}")

print(base / "owner-workday-walk.png")
