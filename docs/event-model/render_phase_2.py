#!/usr/bin/env python3
"""Render the phase-2 EventStorming boundary map from Structurizr DSL."""

from pathlib import Path
from tempfile import TemporaryDirectory
import shutil
import subprocess

base = Path(__file__).resolve().parent
source = "phase-2-aggregates-contexts.dsl"
view = "structurizr-phase-2-boundaries"


def run(*args: str) -> None:
    subprocess.run(args, check=True)


with TemporaryDirectory(prefix=".phase-2-", dir=base) as temp_name:
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
        shutil.copyfile(temp / f"{view}.{fmt}", base / f"phase-2-aggregates-contexts.{fmt}")

print(base / "phase-2-aggregates-contexts.png")
