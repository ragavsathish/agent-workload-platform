"""Narrow host capability API for the isolated voice VM.

The gateway exposes task lifecycle operations and bounded, read-only personal
knowledge queries for the authenticated owner identity. It owns the database,
knowledge-store connection, and approval secrets; none crosses into the VM.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import secrets
import urllib.request
from datetime import UTC, datetime
from io import StringIO
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi import Path as ApiPath
from fastapi.responses import Response
from opentelemetry.propagate import inject
from pydantic import BaseModel, Field
from voice_agent.shared.telemetry import configure_telemetry
from voice_agent.tasking.application.pi_response import parse_pi_event_stream, response_from_text
from voice_agent.tasking.application.service import ProposalError, TaskService
from voice_agent.tasking.application.song_service import SongGenerationError, SongService
from voice_agent.tasking.infrastructure.config import Settings

load_dotenv(os.getenv("AGENT_GATEWAY_ENV_FILE", ".env"), override=True)

gateway_token_file = os.getenv("AGENT_GATEWAY_TOKEN_FILE")
GATEWAY_TOKEN = (
    Path(gateway_token_file).read_text(encoding="utf-8").strip()
    if gateway_token_file
    else os.getenv("AGENT_GATEWAY_TOKEN", "")
)
if len(GATEWAY_TOKEN) < 32:
    raise RuntimeError("AGENT_GATEWAY_TOKEN must contain at least 32 characters")

settings = Settings.from_env()
settings.require_api()
app = FastAPI(
    title="Voice agent gateway",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
telemetry = configure_telemetry("pipecat-agent-gateway")
OXIGRAPH_QUERY_URL = os.getenv("OXIGRAPH_QUERY_URL", "http://oxigraph:7878/query").strip()
OXIGRAPH_UPDATE_URL = os.getenv("OXIGRAPH_UPDATE_URL", "http://oxigraph:7878/update").strip()
DIGITAL_TWIN_READER_TOKEN_FILE = os.getenv("DIGITAL_TWIN_READER_TOKEN_FILE")
DIGITAL_TWIN_READER_TOKEN = (
    Path(DIGITAL_TWIN_READER_TOKEN_FILE).read_text(encoding="utf-8").strip()
    if DIGITAL_TWIN_READER_TOKEN_FILE
    else os.getenv("DIGITAL_TWIN_READER_TOKEN", "")
)
if len(DIGITAL_TWIN_READER_TOKEN) < 32:
    raise RuntimeError("DIGITAL_TWIN_READER_TOKEN must contain at least 32 characters")
DIGITAL_TWIN_WRITER_TOKEN_FILE = os.getenv("DIGITAL_TWIN_WRITER_TOKEN_FILE")
DIGITAL_TWIN_WRITER_TOKEN = (
    Path(DIGITAL_TWIN_WRITER_TOKEN_FILE).read_text(encoding="utf-8").strip()
    if DIGITAL_TWIN_WRITER_TOKEN_FILE
    else os.getenv("DIGITAL_TWIN_WRITER_TOKEN", "")
)
if len(DIGITAL_TWIN_WRITER_TOKEN) < 32:
    raise RuntimeError("DIGITAL_TWIN_WRITER_TOKEN must contain at least 32 characters")
MAX_DIGITAL_TWIN_FACTS = 100
SEARCH_STOP_WORDS = frozenset(
    {
        "a",
        "an",
        "and",
        "are",
        "for",
        "from",
        "how",
        "in",
        "is",
        "of",
        "on",
        "or",
        "the",
        "to",
        "what",
        "where",
        "who",
        "why",
        "with",
    }
)

PROFILE_FACTS_QUERY = """
PREFIX schema: <https://schema.org/>
PREFIX org: <http://www.w3.org/ns/org#>

SELECT ?kind ?label ?source WHERE {
  GRAPH <urn:awp:digital-twin:graph:cv> {
    {
      ?source a schema:Person ; schema:name ?label .
      BIND("person" AS ?kind)
    }
    UNION
    {
      ?source a org:Membership ; org:role/schema:roleName ?label .
      BIND("role" AS ?kind)
    }
    UNION
    {
      ?person schema:knowsAbout ?source .
      ?source schema:name ?label .
      BIND("profile skill" AS ?kind)
    }
  }
}
ORDER BY ?kind ?label ?source
LIMIT 200
"""

LEARNING_FACTS_QUERY = """
PREFIX schema: <https://schema.org/>

SELECT ?kind ?label ?source WHERE {
  GRAPH <urn:awp:digital-twin:graph:learning> {
    {
      ?watch a schema:WatchAction ; schema:object ?source .
      ?source schema:name ?label .
      BIND("watched resource" AS ?kind)
    }
    UNION
    {
      ?source a schema:LearningResource ; schema:teaches ?topic .
      ?topic schema:name ?label .
      BIND("learning topic" AS ?kind)
    }
    UNION
    {
      ?source a schema:Claim ; schema:text ?label .
      BIND("source claim" AS ?kind)
    }
  }
}
ORDER BY ?kind ?label ?source
LIMIT 200
"""

JOURNAL_FACTS_QUERY = """
PREFIX schema: <https://schema.org/>
PREFIX awp: <urn:awp:digital-twin:predicate:>

SELECT ?id ?kind ?label ?source ?status WHERE {
  GRAPH <urn:awp:digital-twin:graph:journal> {
    ?source a schema:CreativeWork ;
      schema:additionalType ?kind ;
      schema:text ?label .
    BIND(STRAFTER(STR(?source), "urn:awp:digital-twin:journal:") AS ?id)
    OPTIONAL { ?source awp:status ?status }
    FILTER(!BOUND(?status) || ?status != "deleted")
  }
}
ORDER BY DESC(?source)
LIMIT 200
"""

JOURNAL_FEEDBACK_QUERY = """
PREFIX schema: <https://schema.org/>
PREFIX awp: <urn:awp:digital-twin:predicate:>

SELECT ?id ?action ?previousType ?correctedType ?correctedText ?source ?createdAt WHERE {
  GRAPH <urn:awp:digital-twin:graph:journal-feedback> {
    ?feedback a schema:ReviewAction ;
      schema:identifier ?id ;
      schema:actionStatus ?action ;
      schema:isBasedOn ?source ;
      schema:dateCreated ?createdAt .
    OPTIONAL { ?feedback awp:previousType ?previousType }
    OPTIONAL { ?feedback awp:correctedType ?correctedType }
    OPTIONAL { ?feedback schema:text ?correctedText }
  }
}
ORDER BY DESC(?createdAt)
LIMIT 500
"""

ACCEPTED_FACTS_QUERY = """
PREFIX schema: <https://schema.org/>

SELECT ?kind ?label ?source WHERE {
  GRAPH <urn:awp:digital-twin:graph:accepted> {
    ?source a schema:Claim ;
      schema:additionalType ?kind ;
      schema:name ?label .
  }
}
ORDER BY ?kind ?label ?source
LIMIT 200
"""

PENDING_REVIEWS_QUERY = """
PREFIX schema: <https://schema.org/>
PREFIX awp: <urn:awp:digital-twin:predicate:>

SELECT ?id ?kind ?profileField ?label ?evidence ?confidence ?lowConfidence ?model ?sourceRef ?capturedAt ?status WHERE {
  GRAPH <urn:awp:digital-twin:graph:review> {
    ?candidate a schema:Claim ;
      schema:identifier ?id ;
      schema:additionalType ?kind ;
      schema:disambiguatingDescription ?profileField ;
      schema:name ?label ;
      schema:text ?evidence ;
      awp:confidence ?confidence ;
      awp:status ?status ;
      schema:isBasedOn ?source ;
      schema:dateCreated ?capturedAt .
    ?source schema:identifier ?sourceRef ; awp:model ?model .
    OPTIONAL { ?candidate awp:lowConfidence ?lowConfidence }
    FILTER(?status = "pending")
  }
}
ORDER BY DESC(?capturedAt) ?id
LIMIT 200
"""


class IdentityRequest(BaseModel):
    identity: str = Field(min_length=3, max_length=320)


class ProposalRequest(IdentityRequest):
    instruction: str = Field(min_length=1, max_length=20_000)
    workspace: str = Field(min_length=1, max_length=4_096)


class SongGenerationRequest(IdentityRequest):
    brief: str = Field(min_length=1, max_length=20_000)
    workspace: str = Field(min_length=1, max_length=4_096)
    style: str = Field(min_length=1, max_length=1_000)
    duration_seconds: int = Field(default=120, alias="durationSeconds", ge=30, le=300)


class DigitalTwinIngestionRequest(IdentityRequest):
    session_id: str = Field(alias="sessionId", min_length=1, max_length=128)
    message_id: str = Field(alias="messageId", min_length=1, max_length=128)
    transcript: str = Field(min_length=1, max_length=20_000)
    captured_at: datetime = Field(alias="capturedAt")


class JournalEntry(BaseModel):
    id: str = Field(pattern=r"^[a-f0-9]{32}:entry:[1-9][0-9]*$")
    type: Literal["thought", "idea", "question", "decision", "goal", "learning", "unclassified"]
    text: str = Field(min_length=1, max_length=1_000)
    topics: list[str] = Field(max_length=8)


class JournalCapture(IdentityRequest):
    id: str = Field(pattern=r"^[a-f0-9]{32}$")
    source_ref: str = Field(alias="sourceRef", min_length=1, max_length=300)
    captured_at: datetime = Field(alias="capturedAt")
    transcript: str = Field(min_length=1, max_length=20_000)
    entries: list[JournalEntry] = Field(max_length=12)


class JournalFeedback(IdentityRequest):
    action: Literal["keep", "delete", "edit", "wrong_type"]
    corrected_type: (
        Literal["thought", "idea", "question", "decision", "goal", "learning", "unclassified"]
        | None
    ) = Field(default=None, alias="correctedType")
    corrected_text: str | None = Field(
        default=None, alias="correctedText", min_length=1, max_length=1_000
    )


class JournalMissFeedback(IdentityRequest):
    capture_id: str = Field(alias="captureId", pattern=r"^[a-f0-9]{32}$")
    expected_type: Literal[
        "thought", "idea", "question", "decision", "goal", "learning", "unclassified"
    ] = Field(alias="expectedType")
    expected_text: str = Field(alias="expectedText", min_length=1, max_length=1_000)


class ReviewCandidate(BaseModel):
    id: str = Field(pattern=r"^[a-f0-9]{32}:candidate:[1-9][0-9]*$")
    label: str = Field(min_length=1, max_length=200)
    evidence_quote: str = Field(alias="evidenceQuote", min_length=1, max_length=1_000)


class AssertionProbabilities(BaseModel):
    conversation_topic: float = Field(ge=0, le=1)
    skill_evidence: float = Field(ge=0, le=1)
    profile_update: float = Field(ge=0, le=1)
    none: float = Field(ge=0, le=1)


class ReviewClassification(BaseModel):
    kind: Literal["conversation_topic", "skill_evidence", "profile_update"]
    confidence: float = Field(ge=0, le=1)
    probabilities: AssertionProbabilities
    profile_field: Literal["job_title", "home_location", "credential", "employment", "none"] = (
        Field(alias="profileField")
    )
    profile_field_confidence: float = Field(alias="profileFieldConfidence", ge=0, le=1)
    low_confidence: bool = Field(alias="lowConfidence")
    model: str = Field(min_length=1, max_length=200)


class ReviewCapture(IdentityRequest):
    id: str = Field(pattern=r"^[a-f0-9]{32}$")
    source_ref: str = Field(alias="sourceRef", min_length=1, max_length=300)
    captured_at: datetime = Field(alias="capturedAt")
    classification: ReviewClassification
    candidates: list[ReviewCandidate] = Field(min_length=1, max_length=8)


class ReviewDecision(IdentityRequest):
    decision: Literal["accept", "reject"]


async def authenticate(authorization: Annotated[str | None, Header()] = None) -> None:
    expected = f"Bearer {GATEWAY_TOKEN}"
    if authorization is None or not secrets.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="invalid agent gateway credential")


async def authenticate_digital_twin_writer(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    expected = f"Bearer {DIGITAL_TWIN_WRITER_TOKEN}"
    if authorization is None or not secrets.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="invalid digital twin writer credential")


async def authenticate_digital_twin_reader(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    expected = f"Bearer {DIGITAL_TWIN_READER_TOKEN}"
    if authorization is None or not secrets.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="invalid digital twin reader credential")


def normalized_identity(identity: str) -> str:
    value = identity.strip().lower()
    allowed = {user.strip().lower() for user in settings.allowed_users}
    if len(allowed) != 1:
        raise HTTPException(
            status_code=503,
            detail="voice gateway requires exactly one configured tailnet identity",
        )
    if not value or value != next(iter(allowed)):
        raise HTTPException(status_code=403, detail="tailnet identity is not allowed")
    return value


def _public_task_result(task_result: object) -> object:
    if not isinstance(task_result, dict):
        return task_result
    public: dict[str, object] = {"state": task_result.get("state", "pending")}
    if task_result.get("failure") is not None:
        public["failure"] = str(task_result["failure"])[:2_000]

    execution = task_result.get("result")
    if not isinstance(execution, dict):
        return public

    response = execution.get("response")
    if isinstance(response, dict):
        normalized = response_from_text(json.dumps(response, ensure_ascii=False))
        original_text = response.get("text")
        response_text = (
            original_text.strip()[:12_000]
            if isinstance(original_text, str) and original_text.strip()
            else normalized.spoken
        )
    elif isinstance(execution.get("stdout"), str):
        try:
            normalized = parse_pi_event_stream(StringIO(execution["stdout"]))
        except RuntimeError:
            normalized = response_from_text(
                "Legacy task completed; its final response is unavailable."
            )
        response_text = normalized.text
    else:
        normalized = response_from_text("Task completed.")
        response_text = normalized.text

    public_execution: dict[str, object] = {
        "exit_code": execution.get("exit_code"),
        "response": {
            "text": response_text,
            "spoken": normalized.spoken,
            "presentation": normalized.presentation,
            "resourceUri": normalized.resource_uri,
        },
    }
    artifacts = execution.get("artifacts")
    if isinstance(artifacts, dict):
        public_execution["artifacts"] = sorted(
            str(name) for name in artifacts if isinstance(name, str)
        )
    public["result"] = public_execution
    return public


def voice_view(result: dict[str, object]) -> dict[str, object]:
    """Remove host capabilities and raw Pi events from the owner-facing view."""
    view = dict(result)
    view.pop("approval_token", None)
    view["result"] = _public_task_result(view.get("result"))
    return view


def service() -> TaskService:
    return TaskService(settings)


def songs() -> SongService:
    return SongService(settings)


def _sparql_rows(query: str) -> list[dict[str, str]]:
    request = urllib.request.Request(
        OXIGRAPH_QUERY_URL,
        data=query.encode("utf-8"),
        headers={
            "Accept": "application/sparql-results+json",
            "Content-Type": "application/sparql-query",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("personal knowledge store is unavailable") from exc

    bindings = payload.get("results", {}).get("bindings", []) if isinstance(payload, dict) else []
    if not isinstance(bindings, list):
        raise RuntimeError("personal knowledge store returned invalid results")
    rows: list[dict[str, str]] = []
    for binding in bindings:
        if not isinstance(binding, dict):
            continue
        row = {
            str(name): str(cell["value"])
            for name, cell in binding.items()
            if isinstance(cell, dict) and isinstance(cell.get("value"), str)
        }
        if row:
            rows.append(row)
    return rows


def _rdf_literal(value: str) -> str:
    return json.dumps(value, ensure_ascii=False).replace("/", "\\/")


def _journal_update(capture: JournalCapture) -> str:
    source = f"urn:awp:digital-twin:journal:{capture.id}"
    captured_at = capture.captured_at.isoformat()
    triples = [
        f"<{source}> a schema:Message ;",
        f"  schema:identifier {_rdf_literal(capture.source_ref)} ;",
        f"  schema:text {_rdf_literal(capture.transcript)} ;",
        f"  schema:dateSent {_rdf_literal(captured_at)}^^xsd:dateTime .",
    ]
    for entry in capture.entries:
        entry_iri = f"urn:awp:digital-twin:journal:{entry.id}"
        properties = [
            f"  schema:identifier {_rdf_literal(entry.id)}",
            f"  schema:additionalType {_rdf_literal(entry.type)}",
            f"  schema:text {_rdf_literal(entry.text)}",
            f"  schema:dateCreated {_rdf_literal(captured_at)}^^xsd:dateTime",
            f"  schema:isBasedOn <{source}>",
            *(f"  schema:keywords {_rdf_literal(topic)}" for topic in entry.topics),
        ]
        triples.append(f"<{entry_iri}> a schema:CreativeWork ;\n" + " ;\n".join(properties) + " .")
    return "\n".join(
        [
            "PREFIX schema: <https://schema.org/>",
            "PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>",
            "INSERT DATA { GRAPH <urn:awp:digital-twin:graph:journal> {",
            *(f"  {triple.replace(chr(10), chr(10) + '  ')}" for triple in triples),
            "} }",
            "",
        ]
    )


def _journal_entry_query(entry_id: str) -> str:
    entry = f"urn:awp:digital-twin:journal:{entry_id}"
    return "\n".join(
        [
            "PREFIX schema: <https://schema.org/>",
            "PREFIX awp: <urn:awp:digital-twin:predicate:>",
            "SELECT ?kind ?label ?status WHERE {",
            "  GRAPH <urn:awp:digital-twin:graph:journal> {",
            f"    <{entry}> a schema:CreativeWork ; schema:additionalType ?kind ; schema:text ?label .",
            f"    OPTIONAL {{ <{entry}> awp:status ?status }}",
            "  }",
            "}",
            "LIMIT 1",
        ]
    )


def _journal_feedback_update(
    entry_id: str,
    feedback: JournalFeedback,
    previous_type: str,
    event_id: str,
    created_at: datetime,
) -> str:
    entry = f"urn:awp:digital-twin:journal:{entry_id}"
    event = f"urn:awp:digital-twin:journal-feedback:{event_id}"
    status = "deleted" if feedback.action == "delete" else "reviewed"
    replacement_type = feedback.corrected_type or previous_type
    delete_text = "schema:text ?oldText ;" if feedback.corrected_text else ""
    insert_text = (
        f"schema:text {_rdf_literal(feedback.corrected_text)} ;" if feedback.corrected_text else ""
    )
    feedback_properties = [
        f"  schema:identifier {_rdf_literal(event_id)}",
        f"  schema:actionStatus {_rdf_literal(feedback.action)}",
        f"  schema:isBasedOn <{entry}>",
        f"  schema:dateCreated {_rdf_literal(created_at.isoformat())}^^xsd:dateTime",
        f"  awp:previousType {_rdf_literal(previous_type)}",
        f"  awp:correctedType {_rdf_literal(replacement_type)}",
    ]
    if feedback.corrected_text:
        feedback_properties.append(f"  schema:text {_rdf_literal(feedback.corrected_text)}")
    return "\n".join(
        [
            "PREFIX schema: <https://schema.org/>",
            "PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>",
            "PREFIX awp: <urn:awp:digital-twin:predicate:>",
            "DELETE { GRAPH <urn:awp:digital-twin:graph:journal> {",
            f"  <{entry}> schema:additionalType ?oldType ; {delete_text} awp:status ?oldStatus .",
            "} }",
            "INSERT {",
            "  GRAPH <urn:awp:digital-twin:graph:journal> {",
            f"    <{entry}> schema:additionalType {_rdf_literal(replacement_type)} ; {insert_text} awp:status {_rdf_literal(status)} .",
            "  }",
            "  GRAPH <urn:awp:digital-twin:graph:journal-feedback> {",
            f"    <{event}> a schema:ReviewAction ;",
            "    " + " ;\n    ".join(feedback_properties) + " .",
            "  }",
            "}",
            "WHERE { GRAPH <urn:awp:digital-twin:graph:journal> {",
            f"  <{entry}> schema:additionalType ?oldType .",
            f"  OPTIONAL {{ <{entry}> schema:text ?oldText }}",
            f"  OPTIONAL {{ <{entry}> awp:status ?oldStatus }}",
            "} }",
            "",
        ]
    )


def _journal_miss_update(feedback: JournalMissFeedback, event_id: str, created_at: datetime) -> str:
    source = f"urn:awp:digital-twin:journal:{feedback.capture_id}"
    event = f"urn:awp:digital-twin:journal-feedback:{event_id}"
    return "\n".join(
        [
            "PREFIX schema: <https://schema.org/>",
            "PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>",
            "PREFIX awp: <urn:awp:digital-twin:predicate:>",
            "INSERT DATA { GRAPH <urn:awp:digital-twin:graph:journal-feedback> {",
            f"  <{event}> a schema:ReviewAction ;",
            f"    schema:identifier {_rdf_literal(event_id)} ;",
            '    schema:actionStatus "missed" ;',
            f"    schema:isBasedOn <{source}> ;",
            f"    schema:dateCreated {_rdf_literal(created_at.isoformat())}^^xsd:dateTime ;",
            f"    awp:correctedType {_rdf_literal(feedback.expected_type)} ;",
            f"    schema:text {_rdf_literal(feedback.expected_text)} .",
            "} }",
            "",
        ]
    )


def _review_update(capture: ReviewCapture) -> str:
    source = f"urn:awp:digital-twin:review-source:{capture.id}"
    classification = capture.classification
    triples = [
        f"<{source}> a schema:Message ;",
        f"  schema:identifier {_rdf_literal(capture.source_ref)} ;",
        f"  schema:dateSent {_rdf_literal(capture.captured_at.isoformat())}^^xsd:dateTime ;",
        f"  awp:model {_rdf_literal(classification.model)} ;",
        f"  awp:profileFieldConfidence {classification.profile_field_confidence} .",
    ]
    for candidate in capture.candidates:
        candidate_iri = f"urn:awp:digital-twin:review:{candidate.id}"
        properties = [
            f"  schema:identifier {_rdf_literal(candidate.id)}",
            f"  schema:additionalType {_rdf_literal(classification.kind)}",
            f"  schema:disambiguatingDescription {_rdf_literal(classification.profile_field)}",
            f"  schema:name {_rdf_literal(candidate.label)}",
            f"  schema:text {_rdf_literal(candidate.evidence_quote)}",
            f"  schema:isBasedOn <{source}>",
            f"  schema:dateCreated {_rdf_literal(capture.captured_at.isoformat())}^^xsd:dateTime",
            f"  awp:confidence {classification.confidence}",
            f"  awp:lowConfidence {str(classification.low_confidence).lower()}",
            '  awp:status "pending"',
        ]
        triples.append(f"<{candidate_iri}> a schema:Claim ;\n" + " ;\n".join(properties) + " .")
    return "\n".join(
        [
            "PREFIX schema: <https://schema.org/>",
            "PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>",
            "PREFIX awp: <urn:awp:digital-twin:predicate:>",
            "INSERT DATA { GRAPH <urn:awp:digital-twin:graph:review> {",
            *(f"  {triple.replace(chr(10), chr(10) + '  ')}" for triple in triples),
            "} }",
            "",
        ]
    )


def _review_candidate_query(candidate_id: str) -> str:
    candidate = f"urn:awp:digital-twin:review:{candidate_id}"
    return "\n".join(
        [
            "PREFIX schema: <https://schema.org/>",
            "PREFIX awp: <urn:awp:digital-twin:predicate:>",
            "SELECT ?kind ?label ?evidence ?status WHERE {",
            "  GRAPH <urn:awp:digital-twin:graph:review> {",
            f"    <{candidate}> schema:additionalType ?kind ;",
            "      schema:name ?label ; schema:text ?evidence ; awp:status ?status .",
            "  }",
            "}",
            "LIMIT 1",
        ]
    )


def _review_decision_update(candidate_id: str, decision: Literal["accept", "reject"]) -> str:
    candidate = f"urn:awp:digital-twin:review:{candidate_id}"
    status = "accepted" if decision == "accept" else "rejected"
    accepted_insert = (
        "GRAPH <urn:awp:digital-twin:graph:accepted> {\n"
        f"  <{candidate}> a schema:Claim ; schema:identifier {_rdf_literal(candidate_id)} ;\n"
        "    schema:additionalType ?kind ; schema:name ?label ; schema:text ?evidence ;\n"
        "    schema:isBasedOn ?source .\n"
        "}"
        if decision == "accept"
        else ""
    )
    return "\n".join(
        [
            "PREFIX schema: <https://schema.org/>",
            "PREFIX awp: <urn:awp:digital-twin:predicate:>",
            "DELETE { GRAPH <urn:awp:digital-twin:graph:review> {",
            f"  <{candidate}> awp:status ?oldStatus .",
            "} }",
            "INSERT {",
            "  GRAPH <urn:awp:digital-twin:graph:review> {",
            f"    <{candidate}> awp:status {_rdf_literal(status)} .",
            "  }",
            f"  {accepted_insert}",
            "}",
            "WHERE { GRAPH <urn:awp:digital-twin:graph:review> {",
            f"  <{candidate}> awp:status ?oldStatus ; schema:additionalType ?kind ;",
            "    schema:name ?label ; schema:text ?evidence ; schema:isBasedOn ?source .",
            "} }",
            "",
        ]
    )


def _sparql_update(update: str) -> None:
    request = urllib.request.Request(
        OXIGRAPH_UPDATE_URL,
        data=update.encode("utf-8"),
        headers={"Content-Type": "application/sparql-update"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            if response.status not in {200, 204}:
                raise RuntimeError("personal knowledge store rejected the journal update")
    except OSError as exc:
        raise RuntimeError("personal knowledge store is unavailable") from exc


def _filter_facts(rows: list[dict[str, str]], search: str) -> list[dict[str, str]]:
    terms = tuple(
        dict.fromkeys(
            term
            for term in re.findall(r"[a-z0-9]+", search.casefold())
            if len(term) > 1 and term not in SEARCH_STOP_WORDS
        )
    )
    if not terms:
        return rows[:MAX_DIGITAL_TWIN_FACTS]
    ranked = []
    for position, row in enumerate(rows):
        searchable = " ".join(row.values()).casefold()
        score = sum(term in searchable for term in terms)
        if score:
            ranked.append((-score, position, row))
    ranked.sort(key=lambda match: (match[0], match[1]))
    return [row for _, _, row in ranked[:MAX_DIGITAL_TWIN_FACTS]]


@app.get("/health")
async def health(_: None = Depends(authenticate)) -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/digital-twin")
async def query_digital_twin(
    identity: str = Query(min_length=3, max_length=320),
    scope: Literal["profile", "learning", "journal", "all"] = Query(default="all"),
    query: str = Query(default="", max_length=200),
    _: None = Depends(authenticate_digital_twin_reader),
):
    normalized_identity(identity)
    with telemetry.observe("digital_twin.query"):
        try:
            rows: list[dict[str, str]] = []
            if scope in {"profile", "all"}:
                rows.extend(await asyncio.to_thread(_sparql_rows, PROFILE_FACTS_QUERY))
                rows.extend(await asyncio.to_thread(_sparql_rows, ACCEPTED_FACTS_QUERY))
            if scope in {"learning", "all"}:
                rows.extend(await asyncio.to_thread(_sparql_rows, LEARNING_FACTS_QUERY))
            if scope in {"journal", "all"}:
                rows.extend(await asyncio.to_thread(_sparql_rows, JOURNAL_FACTS_QUERY))
            return {"scope": scope, "query": query.strip(), "facts": _filter_facts(rows, query)}
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/v1/digital-twin/ingestions", status_code=202)
async def enqueue_digital_twin(
    body: DigitalTwinIngestionRequest,
    _: None = Depends(authenticate),
):
    with telemetry.observe("digital_twin.enqueue"):
        try:
            return await asyncio.to_thread(
                service().enqueue_digital_twin,
                identity=normalized_identity(body.identity),
                session_id=body.session_id,
                message_id=body.message_id,
                transcript=body.transcript,
                captured_at=body.captured_at.isoformat(),
            )
        except ProposalError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/v1/digital-twin/journal")
async def write_digital_twin_journal(
    body: JournalCapture,
    _: None = Depends(authenticate_digital_twin_writer),
):
    normalized_identity(body.identity)
    with telemetry.observe("digital_twin.write"):
        try:
            await asyncio.to_thread(_sparql_update, _journal_update(body))
            return {"captureId": body.id, "entries": len(body.entries)}
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/v1/digital-twin/journal/{entry_id}/feedback")
async def record_journal_feedback(
    entry_id: Annotated[str, ApiPath(pattern=r"^[a-f0-9]{32}:entry:[1-9][0-9]*$")],
    body: JournalFeedback,
    _: None = Depends(authenticate),
):
    normalized_identity(body.identity)
    if body.action == "edit" and body.corrected_text is None:
        raise HTTPException(status_code=422, detail="edit feedback requires correctedText")
    if body.action == "wrong_type" and body.corrected_type is None:
        raise HTTPException(status_code=422, detail="wrong_type feedback requires correctedType")
    if body.action in {"keep", "delete"} and (
        body.corrected_type is not None or body.corrected_text is not None
    ):
        raise HTTPException(status_code=422, detail="keep and delete do not accept corrections")
    with telemetry.observe("digital_twin.journal.feedback"):
        try:
            rows = await asyncio.to_thread(_sparql_rows, _journal_entry_query(entry_id))
            if not rows:
                raise HTTPException(status_code=404, detail="journal entry not found")
            previous_type = rows[0].get("kind")
            if previous_type not in {
                "thought",
                "idea",
                "question",
                "decision",
                "goal",
                "learning",
                "unclassified",
            }:
                raise HTTPException(status_code=409, detail="journal entry has an invalid type")
            event_id = uuid4().hex
            await asyncio.to_thread(
                _sparql_update,
                _journal_feedback_update(
                    entry_id, body, previous_type, event_id, datetime.now(UTC)
                ),
            )
            telemetry.record("digital_twin.journal.feedback.action", outcome=body.action)
            return {"entryId": entry_id, "action": body.action, "feedbackId": event_id}
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/v1/digital-twin/journal/misses")
async def record_journal_miss(
    body: JournalMissFeedback,
    _: None = Depends(authenticate),
):
    normalized_identity(body.identity)
    with telemetry.observe("digital_twin.journal.feedback"):
        try:
            event_id = uuid4().hex
            await asyncio.to_thread(
                _sparql_update,
                _journal_miss_update(body, event_id, datetime.now(UTC)),
            )
            telemetry.record("digital_twin.journal.feedback.action", outcome="missed")
            return {"captureId": body.capture_id, "action": "missed", "feedbackId": event_id}
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/v1/digital-twin/journal/feedback")
async def list_journal_feedback(
    identity: str = Query(min_length=3, max_length=320),
    _: None = Depends(authenticate_digital_twin_reader),
):
    normalized_identity(identity)
    with telemetry.observe("digital_twin.journal.feedback.list"):
        try:
            rows = await asyncio.to_thread(_sparql_rows, JOURNAL_FEEDBACK_QUERY)
            return {"feedback": rows[:500]}
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/v1/digital-twin/reviews")
async def write_digital_twin_reviews(
    body: ReviewCapture,
    _: None = Depends(authenticate_digital_twin_writer),
):
    normalized_identity(body.identity)
    with telemetry.observe("digital_twin.review.write"):
        try:
            await asyncio.to_thread(_sparql_update, _review_update(body))
            return {"captureId": body.id, "candidates": len(body.candidates)}
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/v1/digital-twin/reviews")
async def list_digital_twin_reviews(
    identity: str = Query(min_length=3, max_length=320),
    _: None = Depends(authenticate_digital_twin_reader),
):
    normalized_identity(identity)
    with telemetry.observe("digital_twin.review.list"):
        try:
            rows = await asyncio.to_thread(_sparql_rows, PENDING_REVIEWS_QUERY)
            return {"reviews": rows[:MAX_DIGITAL_TWIN_FACTS]}
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/v1/digital-twin/reviews/{candidate_id}")
async def decide_digital_twin_review(
    candidate_id: Annotated[str, ApiPath(pattern=r"^[a-f0-9]{32}:candidate:[1-9][0-9]*$")],
    body: ReviewDecision,
    _: None = Depends(authenticate),
):
    normalized_identity(body.identity)
    with telemetry.observe("digital_twin.review.decide"):
        try:
            rows = await asyncio.to_thread(_sparql_rows, _review_candidate_query(candidate_id))
            if not rows:
                raise HTTPException(status_code=404, detail="review candidate not found")
            current = rows[0].get("status")
            requested = "accepted" if body.decision == "accept" else "rejected"
            if current not in {"pending", requested}:
                raise HTTPException(status_code=409, detail="review candidate was already decided")
            if current == "pending":
                await asyncio.to_thread(
                    _sparql_update, _review_decision_update(candidate_id, body.decision)
                )
            return {"candidateId": candidate_id, "status": requested}
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/v1/tasks", status_code=201)
async def propose(body: ProposalRequest, _: None = Depends(authenticate)):
    with telemetry.observe("task.propose"):
        try:
            result = await asyncio.to_thread(
                service().propose,
                identity=normalized_identity(body.identity),
                instruction=body.instruction,
                workspace=body.workspace,
            )
            return voice_view(result)
        except (ProposalError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/v1/tasks")
async def list_tasks(
    identity: str = Query(min_length=3, max_length=320),
    limit: int = Query(default=50, ge=1, le=100),
    session_name: str | None = Query(default=None, min_length=1, max_length=200),
    _: None = Depends(authenticate),
):
    with telemetry.observe("task.list"):
        results = await asyncio.to_thread(
            service().list,
            identity=normalized_identity(identity),
            limit=limit,
            session_name=session_name,
        )
        return [voice_view(result) for result in results]


@app.get("/v1/tasks/{proposal_id}")
async def get_task(
    proposal_id: str,
    identity: str = Query(min_length=3, max_length=320),
    _: None = Depends(authenticate),
):
    with telemetry.observe("task.get"):
        try:
            result = await asyncio.to_thread(
                service().get,
                identity=normalized_identity(identity),
                proposal_id=proposal_id,
            )
            return voice_view(result)
        except ProposalError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/v1/tasks/{proposal_id}/progress")
async def get_task_progress(
    proposal_id: str,
    identity: str = Query(min_length=3, max_length=320),
    after: int = Query(default=0, ge=0),
    limit: int = Query(default=40, ge=1, le=100),
    _: None = Depends(authenticate),
):
    with telemetry.observe("task.progress"):
        try:
            return await asyncio.to_thread(
                service().progress,
                identity=normalized_identity(identity),
                proposal_id=proposal_id,
                after=after,
                limit=limit,
            )
        except ProposalError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/v1/tasks/{proposal_id}/approve")
async def approve(
    proposal_id: str,
    body: IdentityRequest,
    _: None = Depends(authenticate),
):
    with telemetry.observe("task.approve"):
        identity = normalized_identity(body.identity)
        try:
            tasks = service()
            pending = await asyncio.to_thread(tasks.get, identity=identity, proposal_id=proposal_id)
            token = pending.get("approval_token")
            if not isinstance(token, str):
                raise ProposalError("proposal is not available for approval")
            trace_context: dict[str, str] = {}
            inject(trace_context)
            result = await asyncio.to_thread(
                tasks.approve,
                identity=identity,
                proposal_id=proposal_id,
                token=token,
                trace_context=trace_context,
            )
            return voice_view(result)
        except ProposalError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/v1/tasks/{proposal_id}/cancel")
async def cancel(
    proposal_id: str,
    body: IdentityRequest,
    _: None = Depends(authenticate),
):
    with telemetry.observe("task.cancel"):
        try:
            result = await asyncio.to_thread(
                service().cancel,
                identity=normalized_identity(body.identity),
                proposal_id=proposal_id,
            )
            return voice_view(result)
        except ProposalError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/v1/music/generations", status_code=202)
async def create_song_generation(
    body: SongGenerationRequest,
    _: None = Depends(authenticate),
):
    with telemetry.observe("song.create"):
        trace_context: dict[str, str] = {}
        inject(trace_context)
        try:
            return await asyncio.to_thread(
                songs().create,
                identity=normalized_identity(body.identity),
                brief=body.brief,
                workspace=body.workspace,
                style=body.style,
                duration_seconds=body.duration_seconds,
                trace_context=trace_context,
            )
        except (SongGenerationError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/v1/music/generations/{generation_id}")
async def get_song_generation(
    generation_id: str,
    identity: str = Query(min_length=3, max_length=320),
    _: None = Depends(authenticate),
):
    with telemetry.observe("song.get"):
        try:
            return await asyncio.to_thread(
                songs().get,
                identity=normalized_identity(identity),
                generation_id=generation_id,
            )
        except SongGenerationError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/v1/music/generations/{generation_id}/render", status_code=202)
async def render_song_generation(
    generation_id: str,
    body: IdentityRequest,
    _: None = Depends(authenticate),
):
    with telemetry.observe("song.render.submit"):
        trace_context: dict[str, str] = {}
        inject(trace_context)
        try:
            return await asyncio.to_thread(
                songs().render,
                identity=normalized_identity(body.identity),
                generation_id=generation_id,
                trace_context=trace_context,
            )
        except SongGenerationError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/v1/music/generations/{generation_id}/cancel")
async def cancel_song_generation(
    generation_id: str,
    body: IdentityRequest,
    _: None = Depends(authenticate),
):
    with telemetry.observe("song.cancel"):
        try:
            return await asyncio.to_thread(
                songs().cancel,
                identity=normalized_identity(body.identity),
                generation_id=generation_id,
            )
        except SongGenerationError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/v1/music/generations/{generation_id}/audio")
async def get_song_audio(
    generation_id: str,
    identity: str = Query(min_length=3, max_length=320),
    _: None = Depends(authenticate),
):
    with telemetry.observe("song.audio"):
        try:
            audio = await asyncio.to_thread(
                songs().audio,
                identity=normalized_identity(identity),
                generation_id=generation_id,
            )
        except SongGenerationError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(
        content=audio,
        media_type="audio/mp4",
        headers={"Cache-Control": "private, max-age=300"},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.getenv("AGENT_GATEWAY_HOST", "127.0.0.1"),
        port=int(os.getenv("AGENT_GATEWAY_PORT", "9444")),
        access_log=False,
    )
