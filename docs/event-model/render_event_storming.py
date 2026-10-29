#!/usr/bin/env python3
"""Render the Structurizr EventStorming views into one PNG."""

from pathlib import Path
from tempfile import TemporaryDirectory
import subprocess

from PIL import Image, ImageDraw, ImageFont


BASE = Path(__file__).resolve().parent
VIEW_KEYS = ("lane-a", "lane-e", "lane-b", "lane-c", "lane-d")
OUTPUT = BASE / "big-picture.png"
FONT = "/System/Library/Fonts/Supplemental/Arial.ttf"
BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def run(*args: str) -> None:
    subprocess.run(args, check=True)


with TemporaryDirectory(prefix=".event-storming-", dir=BASE) as temp_name:
    temp = Path(temp_name)
    temp.chmod(0o777)
    mounted = f"/usr/local/structurizr/{temp.name}"
    volume = f"{BASE}:/usr/local/structurizr"
    run("docker", "run", "--rm", "-v", volume, "structurizr/structurizr",
        "validate", "-workspace", "/usr/local/structurizr/event-storming.dsl")
    run("docker", "run", "--rm", "-v", volume, "structurizr/structurizr",
        "export", "-workspace", "/usr/local/structurizr/event-storming.dsl",
        "-format", "plantuml", "-output", mounted)
    plantuml_files = [f"/work/structurizr-{key}.puml" for key in VIEW_KEYS]
    run("docker", "run", "--rm", "-v", f"{temp}:/work", "plantuml/plantuml",
        "-tpng", *plantuml_files)

    panels = [Image.open(temp / f"structurizr-{key}.png").convert("RGB") for key in VIEW_KEYS]
    margin, gap, header, footer = 60, 30, 165, 70
    width = max(panel.width for panel in panels) + margin * 2
    height = header + sum(panel.height for panel in panels) + gap * (len(panels) - 1) + footer
    canvas = Image.new("RGB", (width, height), "#f7f5f0")
    draw = ImageDraw.Draw(canvas)
    draw.text((margin, 28), "AWP · EventStorming Big Picture", font=ImageFont.truetype(BOLD, 54), fill="#193241")
    draw.text((margin, 101), "Structurizr views · candidate events from Gherkin · domain walkthrough pending",
              font=ImageFont.truetype(FONT, 28), fill="#5a6970")
    y = header
    for panel in panels:
        x = (width - panel.width) // 2
        draw.rounded_rectangle((x - 6, y - 6, x + panel.width + 6, y + panel.height + 6),
                               radius=14, fill="#ffffff", outline="#ddd5c7", width=2)
        canvas.paste(panel, (x, y))
        y += panel.height + gap
    canvas.save(OUTPUT, optimize=True)

print(OUTPUT)
