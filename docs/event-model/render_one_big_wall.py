#!/usr/bin/env python3
"""Validate and render the integrated EventStorming wall from one Structurizr DSL."""

from pathlib import Path
from tempfile import TemporaryDirectory
import subprocess
import re

base = Path(__file__).resolve().parent
source = "one-big-wall.dsl"
view = "structurizr-one-big-wall"


def run(*args: str) -> None:
    subprocess.run(args, check=True)


with TemporaryDirectory(prefix=".one-big-wall-", dir=base) as temp_name:
    temp = Path(temp_name)
    temp.chmod(0o777)
    volume = f"{base}:/usr/local/structurizr"
    run("docker", "run", "--rm", "-v", volume, "structurizr/structurizr",
        "validate", "-workspace", f"/usr/local/structurizr/{source}")
    run("docker", "run", "--rm", "-v", volume, "structurizr/structurizr",
        "export", "-workspace", f"/usr/local/structurizr/{source}",
        "-format", "plantuml", "-output", f"/usr/local/structurizr/{temp.name}")
    run("docker", "run", "--rm", "-e", "PLANTUML_LIMIT_SIZE=32768",
        "-v", f"{temp}:/work", "plantuml/plantuml",
        "-tsvg", f"/work/{view}.puml")
    svg = base / "one-big-wall.svg"
    exported = (temp / f"{view}.svg").read_text(encoding="utf-8")
    # PlantUML sets a CSS background that some SVG viewers ignore. Paint a
    # real white canvas so the same DSL render stays legible in dark viewers.
    painted = re.sub(r"(<svg\b[^>]*>)", r'\1<rect x="0" y="0" width="100%" height="100%" fill="#ffffff"/>', exported, count=1)
    assert painted != exported
    svg.write_text(painted, encoding="utf-8")
    run("rsvg-convert", "-b", "white", "-o", str(base / "one-big-wall.png"), str(svg))

print(base / "one-big-wall.png")
