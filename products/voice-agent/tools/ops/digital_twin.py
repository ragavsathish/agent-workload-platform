"""Load, query, and capture the private digital-twin RDF dataset."""

from __future__ import annotations

import argparse
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PI_AGENT = ROOT / "apps/pi-agent"
RUNTIME = PI_AGENT / "digital-twin/runtime"
COMPOSE = [
    "docker",
    "compose",
    "--env-file",
    str(ROOT / "deploy/.env"),
    "-f",
    str(ROOT / "deploy/compose.yml"),
]


def run(
    args: list[str], *, input_data: bytes | None = None, capture_output: bool = False
) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(args, input=input_data, check=True, capture_output=capture_output)


def oxigraph(path: str, content_type: str, data: bytes, accept: str | None = None) -> bytes:
    command = [*COMPOSE, "exec", "-T", "gitea", "wget", "-q", "-O", "-"]
    if accept:
        command.extend(["--header", f"Accept: {accept}"])
    command.extend(
        [
            "--header",
            f"Content-Type: {content_type}",
            "--post-file",
            "/dev/stdin",
            f"http://oxigraph:7878/{path}",
        ]
    )
    return run(command, input_data=data, capture_output=True).stdout


def load() -> None:
    private_dir = Path(os.environ.get("DIGITAL_TWIN_DIR", RUNTIME / "rdf/private")).resolve()
    graph_base = os.environ.get("DIGITAL_TWIN_GRAPH_BASE", "urn:awp:digital-twin:graph:")
    run(
        [
            "uv",
            "run",
            "--with",
            "pyshacl>=0.30,<1",
            "python",
        str(RUNTIME / "scripts/validate.py"),
            "--shapes",
            str(RUNTIME / "rdf/shapes/profile.shacl.ttl"),
            str(private_dir),
        ]
    )
    for filename, suffix in (
        ("cv.ttl", "cv"),
        ("conversation.ttl", "conversation"),
        ("learning.ttl", "learning"),
        ("provenance.ttl", "provenance"),
    ):
        source = private_dir / filename
        if not source.is_file() or source.stat().st_size == 0:
            raise SystemExit(f"Missing private digital-twin source: {source}")
        graph = f"{graph_base}{suffix}"
        oxigraph("update", "application/sparql-update", f"CLEAR SILENT GRAPH <{graph}>".encode())
        oxigraph(f"store?graph={graph}", "text/turtle", source.read_bytes())
        print(f"Loaded {filename} into {graph}")
    query = (
        "ASK { "
        + " ".join(
            f"GRAPH <{graph_base}{suffix}> {{ ?{suffix}S ?{suffix}P ?{suffix}O }}"
            for suffix in ("cv", "conversation", "learning", "provenance")
        )
        + " }"
    )
    result = oxigraph(
        "query",
        "application/sparql-query",
        query.encode(),
        "application/sparql-results+json",
    )
    if b'"boolean":true' not in result:
        raise SystemExit("Digital-twin verification query returned false")
    print("Digital twin loaded and query-verified.")


def query(path: str | None) -> None:
    query_file = Path(path) if path else RUNTIME / "rdf/queries/profile-summary.rq"
    if not query_file.is_file():
        raise SystemExit(f"SPARQL query file not found: {query_file}")
    result = oxigraph(
        "query",
        "application/sparql-query",
        query_file.read_bytes(),
        "application/sparql-results+json",
    )
    print(result.decode(), end="")


def capture() -> None:
    run(["pnpm", "--dir", str(PI_AGENT), "build"], capture_output=True)
    captured = run(["node", str(RUNTIME / "capture-journal.mjs")], capture_output=True).stdout
    update = run(
        ["node", str(RUNTIME / "journal-to-sparql.mjs")],
        input_data=captured,
        capture_output=True,
    ).stdout
    oxigraph("update", "application/sparql-update", update)
    print(captured.decode(), end="")


def main() -> None:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("load")
    query_parser = commands.add_parser("query")
    query_parser.add_argument("path", nargs="?")
    commands.add_parser("capture")
    args = parser.parse_args()
    if args.command == "load":
        load()
    elif args.command == "query":
        query(args.path)
    else:
        capture()


if __name__ == "__main__":
    main()
