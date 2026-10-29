#!/usr/bin/env python3
"""Validate and render the Structurizr operating-loop view."""

from pathlib import Path
from tempfile import TemporaryDirectory
import shutil
import subprocess


base = Path(__file__).resolve().parent
source = base / "orchestrator-theme.dsl"
output = base / "orchestrator-theme.png"


def run(*args: str) -> None:
    subprocess.run(args, check=True)


with TemporaryDirectory(prefix=".orchestrator-theme-", dir=base) as temp_name:
    temp = Path(temp_name)
    temp.chmod(0o777)
    volume = f"{base}:/usr/local/structurizr"
    run("docker", "run", "--rm", "-v", volume, "structurizr/structurizr",
        "validate", "-workspace", f"/usr/local/structurizr/{source.name}")
    run("docker", "run", "--rm", "-v", volume, "structurizr/structurizr",
        "export", "-workspace", f"/usr/local/structurizr/{source.name}",
        "-format", "plantuml", "-output", f"/usr/local/structurizr/{temp.name}")
    run("docker", "run", "--rm", "-e", "PLANTUML_LIMIT_SIZE=8192",
        "-v", f"{temp}:/work", "plantuml/plantuml",
        "-tpng", "/work/structurizr-operating-loop.puml")
    shutil.copyfile(temp / "structurizr-operating-loop.png", output)

print(output)
