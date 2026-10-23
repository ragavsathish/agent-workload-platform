"""Black-box regression for ranked personal-knowledge retrieval through Wassette."""

from __future__ import annotations

import json
import selectors
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = [
    "docker",
    "compose",
    "--env-file",
    str(ROOT / "deploy/.env"),
    "-f",
    str(ROOT / "deploy/compose.yml"),
]
COMPONENT_DIR = Path.home() / "Library/Application Support/PipecatEdge/wassette-components"
WASSETTE = Path.home() / ".local/bin/wassette"
JOURNAL_GRAPH = "urn:awp:digital-twin:graph:journal"


def configured_identity() -> str:
    for line in (ROOT / "deploy/.env").read_text(encoding="utf-8").splitlines():
        if line.startswith("ORCHESTRATOR_ALLOWED_USERS="):
            return line.partition("=")[2].strip().strip('"').split(",", 1)[0]
    raise RuntimeError("ORCHESTRATOR_ALLOWED_USERS is not configured")


def sparql_update(update: str) -> None:
    subprocess.run(
        [
            *COMPOSE,
            "exec",
            "-T",
            "gitea",
            "wget",
            "-q",
            "-O",
            "-",
            "--header",
            "Content-Type: application/sparql-update",
            "--post-file",
            "/dev/stdin",
            "http://oxigraph:7878/update",
        ],
        cwd=ROOT,
        input=update,
        text=True,
        check=True,
    )


def read_response(process: subprocess.Popen[str], request_id: int) -> dict[str, Any]:
    assert process.stdout is not None
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if not selector.select(timeout=max(0, deadline - time.monotonic())):
            break
        line = process.stdout.readline()
        if not line:
            break
        message: dict[str, Any] = json.loads(line)
        if message.get("id") == request_id:
            return message
    raise RuntimeError(f"Wassette did not answer MCP request {request_id}")


def invoke_tool(name: str, arguments: dict[str, Any]) -> Any:
    token = (ROOT / "deploy/secrets/digital-twin-reader-token").read_text(
        encoding="utf-8"
    ).strip()
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as env_file:
        env_file.write('KNOWLEDGE_GATEWAY_BASE_URL="http://127.0.0.1:9444/v1"\n')
        env_file.write(f'KNOWLEDGE_GATEWAY_TOKEN="{token}"\n')
        env_file.write(f'KNOWLEDGE_IDENTITY="{configured_identity()}"\n')
        env_file.write('OXIGRAPH_QUERY_URL="http://127.0.0.1:7878/query"\n')
        env_path = Path(env_file.name)
    env_path.chmod(0o600)
    process = subprocess.Popen(
        [
            str(WASSETTE),
            "run",
            "--disable-builtin-tools",
            "--component-dir",
            str(COMPONENT_DIR),
            "--env-file",
            str(env_path),
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    try:
        assert process.stdin is not None
        process.stdin.write(json.dumps({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "personal-knowledge-regression", "version": "1.0.0"},
            },
        }) + "\n")
        process.stdin.flush()
        read_response(process, 1)
        process.stdin.write(json.dumps({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
        }) + "\n")
        process.stdin.flush()
        time.sleep(1)
        process.stdin.write(json.dumps({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": name,
                "arguments": arguments,
            },
        }) + "\n")
        process.stdin.flush()
        response = read_response(process, 2)
        result = response["result"]
        if result.get("isError"):
            raise RuntimeError(result["content"][0]["text"])
        return result["structuredContent"]["result"]["ok"]
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
        env_path.unlink(missing_ok=True)


def main() -> None:
    subprocess.run(
        [*COMPOSE, "up", "-d", "--wait", "--build", "gitea", "oxigraph", "agent-gateway"],
        cwd=ROOT,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    fixture_id = uuid.uuid4().hex
    source = f"urn:awp:digital-twin:test:search-regression:{fixture_id}"
    journal_source = f"urn:awp:digital-twin:journal:source-{fixture_id}"
    journal_entry = f"urn:awp:digital-twin:journal:note-{fixture_id}"
    sparql_update(
        "PREFIX schema: <https://schema.org/>\n"
        f"INSERT DATA {{ GRAPH <{JOURNAL_GRAPH}> {{\n"
        f"  <{source}> a schema:CreativeWork ;\n"
        '    schema:additionalType "learning" ;\n'
        '    schema:text "Understanding the structure of reasoning in language models" .\n'
        f"  <{journal_source}> schema:identifier \"MCP journal regression {fixture_id}\" ;\n"
        '    schema:text "The original transcript for the MCP journal regression fixture." .\n'
        f"  <{journal_entry}> a schema:CreativeWork ;\n"
        '    schema:additionalType "idea" ;\n'
        '    schema:text "A journal entry returned by the personal knowledge MCP tool." ;\n'
        '    schema:dateCreated "2026-10-23T10:00:00Z" ;\n'
        f"    schema:isBasedOn <{journal_source}> ;\n"
        '    schema:keywords "MCP regression" .\n'
        "} }"
    )
    try:
        result = invoke_tool(
            "query-personal-knowledge",
            {"scope": "journal", "query": "Soheil Feizi reasoning language models"},
        )
        sources = {fact["source"] for fact in result["facts"]}
        if source not in sources:
            raise AssertionError(
                "broad natural-language query did not return the relevant knowledge fact"
            )
        print("PASS Wassette returned a relevant Oxigraph fact despite unmatched query terms")

        entries = invoke_tool("query-journal", {})
        entry = next((item for item in entries if item["id"] == f"note-{fixture_id}"), None)
        if entry is None:
            raise AssertionError("query-journal did not return the seeded journal entry")
        source_label = entry.get("source-label", entry.get("sourceLabel"))
        if source_label != f"MCP journal regression {fixture_id}":
            raise AssertionError("query-journal did not return the source label")
        if entry["transcript"] != "The original transcript for the MCP journal regression fixture.":
            raise AssertionError("query-journal did not return the source transcript")
        if entry["topics"] != ["MCP regression"]:
            raise AssertionError("query-journal did not return the entry topics")
        print("PASS Wassette query-journal returned the journal entry, source transcript, and topic")
    finally:
        for subject in (source, journal_source, journal_entry):
            sparql_update(
                f"DELETE WHERE {{ GRAPH <{JOURNAL_GRAPH}> {{ <{subject}> ?predicate ?object }} }}"
            )


if __name__ == "__main__":
    main()
