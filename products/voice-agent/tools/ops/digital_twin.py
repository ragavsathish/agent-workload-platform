"""Load, query, and capture the private digital-twin RDF dataset."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

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
            "--shapes", str(RUNTIME / "rdf/shapes/profile.shacl.ttl"),
            "--shapes", str(RUNTIME / "rdf/shapes/personal-knowledge.shacl.ttl"),
            "--vocabulary", str(RUNTIME / "rdf/ontology/personal-knowledge.ttl"),
            "--vocabulary", str(RUNTIME / "rdf/ontology/concepts.ttl"),
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
    ontology_files = sorted((RUNTIME / "rdf/ontology").glob("*.ttl"))
    ontology_graph = f"{graph_base}ontology"
    ontology_data = b"\n".join(path.read_bytes() for path in ontology_files)
    oxigraph("update", "application/sparql-update", f"CLEAR SILENT GRAPH <{ontology_graph}>".encode())
    oxigraph(f"store?graph={ontology_graph}", "text/turtle", ontology_data)
    print(f"Loaded {len(ontology_files)} ontology files into {ontology_graph}")
    query = (
        "ASK { "
        + " ".join(
            f"GRAPH <{graph_base}{suffix}> {{ ?{suffix}S ?{suffix}P ?{suffix}O }}"
            for suffix in ("cv", "conversation", "learning", "provenance", "ontology")
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


def migration_update(time_zone: str) -> bytes:
    try:
        ZoneInfo(time_zone)
    except ZoneInfoNotFoundError as exc:
        raise SystemExit(f"Unknown IANA timezone: {time_zone}") from exc
    path = RUNTIME / "rdf/migrations/001_typed_journal_projections.ru"
    return path.read_text(encoding="utf-8").replace("__TIME_ZONE__", json.dumps(time_zone)).encode()


def migration_preview() -> dict[str, int]:
    queries = {
        "dailyJournalPages": """
          PREFIX legacy: <urn:awp:digital-twin:predicate:>
          PREFIX pk: <urn:voice-agent:personal-knowledge:ontology#>
          PREFIX prov: <http://www.w3.org/ns/prov#>
          PREFIX schema: <https://schema.org/>
          PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
          SELECT (COUNT(DISTINCT ?page) AS ?count) WHERE {
            GRAPH <urn:awp:digital-twin:graph:journal> {
              ?page a schema:CreativeWork ; legacy:recordKind \"codex_daily_journal\" ;
                schema:identifier ?identifier ; ?sourceProperty ?source .
              VALUES ?sourceProperty { schema:isBasedOn prov:wasDerivedFrom }
              FILTER(isIRI(?source))
              FILTER(REGEX(STR(?identifier), \"codex-daily-journal:[0-9]{4}-[0-9]{2}-[0-9]{2}\"))
              FILTER NOT EXISTS { ?page a pk:DailyJournal }
              FILTER NOT EXISTS {
                ?page prov:wasGeneratedBy ?activityA, ?activityB .
                FILTER(?activityA != ?activityB)
              }
              FILTER NOT EXISTS {
                ?page schema:hasPart ?part .
                FILTER NOT EXISTS { ?part a pk:JournalEntry }
              }
              FILTER NOT EXISTS {
                ?page prov:wasGeneratedBy ?untypedActivity .
                FILTER NOT EXISTS { ?untypedActivity a prov:Activity }
              }
            }
          }
        """,
        "classifierPredictions": """
          PREFIX legacy: <urn:awp:digital-twin:predicate:>
          PREFIX oa: <http://www.w3.org/ns/oa#>
          PREFIX prov: <http://www.w3.org/ns/prov#>
          PREFIX schema: <https://schema.org/>
          PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
          SELECT (COUNT(DISTINCT ?record) AS ?count) WHERE {
            GRAPH <urn:awp:digital-twin:graph:assertion-classification> {
              ?record legacy:recordKind \"systemone_assertion_classification\" ;
                schema:additionalType ?kind ; legacy:confidence ?confidence ;
                schema:isBasedOn ?source .
              FILTER(isIRI(?source))
              OPTIONAL { ?record legacy:model ?model }
              FILTER NOT EXISTS { ?record oa:hasBody ?body }
              FILTER NOT EXISTS { ?record oa:hasTarget ?existingTarget }
            }
            GRAPH <urn:awp:digital-twin:graph:journal> { ?source a schema:Message }
            FILTER(xsd:decimal(?confidence) >= 0 && xsd:decimal(?confidence) <= 1)
            FILTER(REPLACE(LCASE(STR(?kind)), \"[ -]+\", \"_\") IN (\"conversation_topic\", \"skill_evidence\", \"profile_update\", \"none\"))
          }
        """,
    }
    counts: dict[str, int] = {}
    for name, query_text in queries.items():
        payload = json.loads(oxigraph("query", "application/sparql-query", query_text.encode(), "application/sparql-results+json"))
        rows = payload.get("results", {}).get("bindings", [])
        counts[name] = int(rows[0]["count"]["value"]) if rows else 0
    return counts


def migrate(*, apply: bool, time_zone: str | None) -> None:
    counts = migration_preview()
    report: dict[str, object] = {"mode": "apply" if apply else "preview", **counts}
    if not apply:
        report["note"] = "Read-only preview. Use --apply and an explicit --time-zone to add typed projections."
        print(json.dumps(report, indent=2))
        return
    if not time_zone:
        raise SystemExit("--time-zone is required with --apply; migration never guesses the journal timezone")
    update = migration_update(time_zone)
    oxigraph("update", "application/sparql-update", update)
    report["timeZone"] = time_zone
    report["applied"] = True
    print(json.dumps(report, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("load")
    query_parser = commands.add_parser("query")
    query_parser.add_argument("path", nargs="?")
    commands.add_parser("capture")
    migrate_parser = commands.add_parser("migrate")
    migrate_parser.add_argument("--apply", action="store_true", help="Write typed projections; default is read-only preview")
    migrate_parser.add_argument("--time-zone", help="IANA timezone for legacy daily pages; required with --apply")
    args = parser.parse_args()
    if args.command == "load":
        load()
    elif args.command == "query":
        query(args.path)
    elif args.command == "capture":
        capture()
    else:
        migrate(apply=args.apply, time_zone=args.time_zone)


if __name__ == "__main__":
    main()
