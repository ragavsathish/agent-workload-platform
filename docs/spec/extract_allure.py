#!/usr/bin/env python3
"""Snapshot recorded Allure steps as traceable, non-executable Gherkin.

Usage: python3 docs/spec/extract_allure.py [path/to/latest.json]
Only result metadata and step names are copied; attachments and payloads stay in the
ignored local report directory. Output files are deterministic for a given run.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "docs/evidence/allure"
KEYWORDS = ("Given ", "When ", "Then ", "And ", "But ")


def label(result: dict, name: str, default: str = "unlabeled") -> str:
    return next(
        (item["value"] for item in result.get("labels", []) if item.get("name") == name),
        default,
    )


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def clean(value: str) -> str:
    return " ".join(value.split())


def main() -> None:
    latest_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "artifacts/test-reports/latest.json"
    latest = json.loads(latest_path.read_text())
    results_root = Path(latest["resultsRoot"])
    if not results_root.is_dir():
        raise SystemExit(f"Missing Allure results: {results_root}")
    records = []
    for path in sorted(results_root.glob("*-result.json")):
        result = json.loads(path.read_text())
        steps = [
            clean(step["name"])
            for step in result.get("steps", [])
            if step.get("name", "").startswith(KEYWORDS)
        ]
        records.append({
            "file": path.name,
            "name": clean(result.get("name", "unnamed case")),
            "epic": clean(label(result, "epic")),
            "feature": clean(label(result, "feature")),
            "layer": label(result, "validationLayer"),
            "status": result.get("status", "unknown"),
            "steps": steps,
            "source": result.get("fullName", ""),
        })
    if not records:
        raise SystemExit("No Allure result JSON files found")

    grouped = defaultdict(list)
    for record in records:
        if record["steps"] and record["status"] == "passed":
            grouped[(record["epic"], record["feature"])].append(record)

    output_dir = EVIDENCE / "features"
    output_dir.mkdir(parents=True, exist_ok=True)
    written = set()
    for (epic, feature), cases in sorted(grouped.items()):
        path = output_dir / f"{slug(epic)}--{slug(feature)}.feature"
        written.add(path)
        lines = [
            f"# Extracted from Allure run {latest['runId']} at commit {latest.get('commit', 'unknown')}.",
            "# Observed passed steps; no step definitions or executable binding are implied.",
            f"# Epic: {epic}",
            f"Feature: {feature}",
            "",
        ]
        for case in sorted(cases, key=lambda item: (item["name"], item["file"])):
            lines.extend([
                f"  # Allure result: {case['file']}",
                f"  # Validation layer: {case['layer']}; source: {case['source']}",
                f"  Scenario: {case['name']} [{case['file'][:8]}]",
                *(f"    {step}" for step in case["steps"]),
                "",
            ])
        path.write_text("\n".join(lines).rstrip() + "\n")
    for path in output_dir.glob("*.feature"):
        if path not in written:
            path.unlink()

    counts = Counter(record["status"] for record in records)
    stepful = [record for record in records if record["steps"] and record["status"] == "passed"]
    lines = [
        "# Allure measurement snapshot",
        "",
        f"**Pinned run:** `{latest['runId']}` at commit `{latest.get('commit', 'unknown')}` "
        f"(`{latest.get('createdAt', 'unknown time')}`).",
        f"**Results:** {len(records)} total; " + ", ".join(f"{status} {count}" for status, count in sorted(counts.items())) + ".",
        f"**Recorded steps:** {sum(len(record['steps']) for record in stepful)} steps "
        f"in {len(stepful)} passed cases; {len(records) - len(stepful)} cases have no passed Gherkin steps.",
        "",
        "The feature files below preserve the recorded step names and order, grouped by Allure",
        "epic and feature. They are an **observed test specification**, not a new source of",
        "product authority or an executable Cucumber suite. The validation layer records",
        "whether a case exercised a deployed journey, deployed integration, or a fixture or",
        "component boundary. A passed mock case does not prove the deployed path. This snapshot",
        "does not copy attachments, transcripts, credentials, or other payloads.",
        "",
        "The result filenames in each scenario resolve under the ignored local directory",
        f"`artifacts/test-reports/{latest['runId']}/allure-results/`. The HTML report is at",
        f"`artifacts/test-reports/{latest['runId']}/report/index.html` when available.",
        "A newer Allure run does not retroactively change this snapshot; rerun",
        "`python3 docs/spec/extract_allure.py` to refresh it and review the diff.",
        "",
        "## Durable behavior specs",
        "",
        "The [bounded-context specs](../../spec/contexts/index.md) own domain rules C1–C9.",
        "The [owner journey slice](../../plan/04-owner-work-to-release/spec.feature) composes",
        "those rules across contexts using stable scenario IDs. They are curated contracts;",
        "the Allure files below remain observed measurements of a pinned run.",
        "",
        "## Feature files",
        "",
    ]
    for path in sorted(written):
        group = next(key for key in grouped if path.name == f"{slug(key[0])}--{slug(key[1])}.feature")
        cases = grouped[group]
        layers = ", ".join(f"{name}: {count}" for name, count in sorted(Counter(c["layer"] for c in cases).items()))
        case_word = "case" if len(cases) == 1 else "cases"
        lines.append(f"- [{group[0]} / {group[1]}](features/{path.name}) — {len(cases)} {case_word} ({layers})")
    lines.extend([
        "",
        "## Coverage boundary",
        "",
        "The [case inventory](cases.md) lists every result, including cases without Gherkin",
        "steps and skipped cases. Those cases may contain useful assertions, but this extractor",
        "does not invent acceptance steps for them. In particular, inspect the skipped Grafana",
        "trace MCP App journey before claiming that entire browser path is covered.",
        "",
        "The existing [voice-to-durable plan](../../plan/01-voice-to-durable/plan.md) interprets",
        "one product slice. Its acceptance text is intentionally curated; the extracted file",
        "[here](features/durable-work--continue-durable-work.feature) records exact Allure steps.",
        "",
    ])
    (EVIDENCE / "index.md").write_text("\n".join(lines))

    lines = [
        "# Allure case inventory",
        "",
        f"Run `{latest['runId']}`. `Result` is a filename under that run's `allure-results/` directory.",
        "A zero in `Steps` means no Gherkin-prefixed top-level steps were recorded; it does",
        "not mean the test had no assertions.",
        "",
        "| Epic / feature | Case | Layer | Status | Steps | Result |",
        "| --- | --- | --- | --- | ---: | --- |",
    ]
    for record in sorted(records, key=lambda item: (item["epic"], item["feature"], item["name"], item["file"])):
        cells = [
            f"{record['epic']} / {record['feature']}", record["name"], record["layer"],
            record["status"], str(len(record["steps"])), f"`{record['file']}`",
        ]
        lines.append("| " + " | ".join(cell.replace("|", "\\|") for cell in cells) + " |")
    (EVIDENCE / "cases.md").write_text("---\ntype: measurement\ntitle: Allure case inventory\n---\n\n" + "\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
