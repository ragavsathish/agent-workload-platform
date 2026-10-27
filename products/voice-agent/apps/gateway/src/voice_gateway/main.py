"""Narrow host capability API for the isolated voice VM.

The gateway exposes direct task lifecycle operations and bounded, read-only personal
knowledge queries for the authenticated owner identity. Database and knowledge-store
connections remain outside the VM.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import secrets
import urllib.request
from datetime import UTC, date, datetime
from io import StringIO
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from botocore.exceptions import ClientError
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi import Path as ApiPath
from fastapi.responses import Response
from opentelemetry.propagate import inject
from pydantic import BaseModel, Field, field_validator, model_validator
from voice_agent.shared.telemetry import configure_telemetry
from voice_agent.tasking.application.pi_response import parse_pi_event_stream, response_from_text
from voice_agent.tasking.application.service import TaskError, TaskService
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
    OPTIONAL {
      GRAPH <urn:awp:digital-twin:graph:review> {
        ?source schema:identifier ?sourceRef ; awp:model ?model .
      }
    }
    OPTIONAL {
      GRAPH <urn:awp:digital-twin:graph:assertion-classification> {
        ?source schema:identifier ?sourceRef ; awp:model ?model .
      }
    }
    OPTIONAL { ?candidate awp:lowConfidence ?lowConfidence }
    FILTER(?status = "pending")
  }
}
ORDER BY DESC(?capturedAt) ?id
LIMIT 200
"""


class IdentityRequest(BaseModel):
    identity: str = Field(min_length=3, max_length=320)


class TaskSubmissionRequest(IdentityRequest):
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

    @field_validator("captured_at")
    @classmethod
    def captured_at_must_have_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("capturedAt must include a timezone")
        return value


class DailyJournalSource(BaseModel):
    source_ref: str = Field(alias="sourceRef", min_length=1, max_length=512)
    speaker: Literal["owner"]
    captured_at: datetime = Field(alias="capturedAt")
    transcript: str = Field(min_length=1, max_length=20_000)

    @field_validator("captured_at")
    @classmethod
    def captured_at_must_have_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("capturedAt must include a timezone")
        return value


class DailyJournalCapture(IdentityRequest):
    id: str = Field(pattern=r"^[a-f0-9]{32}$")
    task_id: str | None = Field(default=None, alias="taskId", max_length=100)
    journal_date: date = Field(alias="journalDate")
    time_zone: str = Field(alias="timeZone", min_length=1, max_length=64)
    captured_at: datetime = Field(alias="capturedAt")
    title: str = Field(min_length=1, max_length=200)
    story: str = Field(min_length=1, max_length=8_000)
    sources: list[DailyJournalSource] = Field(min_length=1, max_length=300)

    @field_validator("story")
    @classmethod
    def story_must_be_prose(cls, value: str) -> str:
        if re.search(r"(?m)^\s*(?:#{1,6}\s|[-*]\s|\d+[.)]\s)", value):
            raise ValueError("daily journal story must be prose, not a list or outline")
        return value

    @model_validator(mode="after")
    def validate_sources_and_timezone(self) -> DailyJournalCapture:
        if self.captured_at.tzinfo is None or self.captured_at.utcoffset() is None:
            raise ValueError("capturedAt must include a timezone")
        try:
            zone = ZoneInfo(self.time_zone)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("timeZone must be a valid IANA timezone") from exc
        refs = [source.source_ref for source in self.sources]
        if len(set(refs)) != len(refs):
            raise ValueError("sourceRefs must be unique")
        if any(source.captured_at.astimezone(zone).date() != self.journal_date for source in self.sources):
            raise ValueError("every source must fall within journalDate in timeZone")
        if sum(len(source.transcript) for source in self.sources) > 200_000:
            raise ValueError("daily journal sources exceed 200,000 characters")
        return self


class DailyJournalTaskRequest(IdentityRequest):
    journal_date: date = Field(alias="journalDate")
    time_zone: str = Field(alias="timeZone", min_length=1, max_length=64)
    sources: list[DailyJournalSource] = Field(min_length=1, max_length=300)

    @model_validator(mode="after")
    def validate_sources_and_timezone(self) -> DailyJournalTaskRequest:
        try:
            zone = ZoneInfo(self.time_zone)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("timeZone must be a valid IANA timezone") from exc
        refs = [source.source_ref for source in self.sources]
        if len(set(refs)) != len(refs):
            raise ValueError("sourceRefs must be unique")
        if any(source.captured_at.astimezone(zone).date() != self.journal_date for source in self.sources):
            raise ValueError("every source must fall within journalDate in timeZone")
        if sum(len(source.transcript) for source in self.sources) > 200_000:
            raise ValueError("daily journal sources exceed 200,000 characters")
        return self


class JournalFeedback(IdentityRequest):
    action: Literal["keep", "delete", "edit", "wrong_type"]
    corrected_type: (
        Literal["thought", "idea", "question", "decision", "goal", "learning", "unclassified"]
        | None
    ) = Field(default=None, alias="correctedType")
    corrected_text: str | None = Field(
        default=None, alias="correctedText", min_length=1, max_length=1_000
    )
    corrected_topics: list[str] | None = Field(default=None, alias="correctedTopics", max_length=12)

    @field_validator("corrected_topics")
    @classmethod
    def validate_topics(cls, topics: list[str] | None) -> list[str] | None:
        if topics is None:
            return None
        normalized = [topic.strip() for topic in topics]
        if any(not topic or len(topic) > 80 for topic in normalized) or len(set(normalized)) != len(
            normalized
        ):
            raise ValueError("topics must be unique nonempty strings of at most 80 characters")
        return normalized


class AssertionReview(IdentityRequest):
    owner_authored: bool = Field(alias="ownerAuthored")
    expected_kind: (
        Literal["none", "conversation_topic", "skill_evidence", "profile_update"] | None
    ) = Field(default=None, alias="expectedKind")
    expected_profile_field: (
        Literal["none", "job_title", "home_location", "credential", "employment"] | None
    ) = Field(default=None, alias="expectedProfileField")
    reason: str = Field(min_length=3, max_length=500)


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

    @field_validator("captured_at")
    @classmethod
    def captured_at_must_have_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("capturedAt must include a timezone")
        return value


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
    """Remove legacy capability fields and raw Pi events from the owner-facing view."""
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
    return json.dumps(value, ensure_ascii=False)


def _journal_update(capture: JournalCapture) -> str:
    source = f"urn:awp:digital-twin:journal:{capture.id}"
    activity = f"urn:awp:digital-twin:activity:journal:{capture.id}"
    captured_at = capture.captured_at.isoformat()
    kind_iris = {
        "thought": "thought",
        "idea": "idea",
        "question": "question",
        "decision": "decision",
        "goal": "goal",
        "learning": "learning",
        "unclassified": "unclassified",
    }
    triples = [
        f"<{source}> a schema:Message, prov:Entity ;\n"
        + " ;\n".join(
            [
                f"  schema:identifier {_rdf_literal(capture.source_ref)}",
                f"  schema:text {_rdf_literal(capture.transcript)}",
                f"  schema:dateSent {_rdf_literal(captured_at)}^^xsd:dateTimeStamp",
            ]
        )
        + " ."
    ]
    for entry in capture.entries:
        entry_iri = f"urn:awp:digital-twin:journal:{entry.id}"
        kind_iri = f"urn:voice-agent:personal-knowledge:concept:journal-kind:{kind_iris[entry.type]}"
        properties = [
            f"  schema:identifier {_rdf_literal(entry.id)}",
            f"  schema:additionalType {_rdf_literal(entry.type)}",
            f"  pk:journalEntryKind <{kind_iri}>",
            f"  schema:text {_rdf_literal(entry.text)}",
            f"  schema:dateCreated {_rdf_literal(captured_at)}^^xsd:dateTimeStamp",
            f"  prov:wasDerivedFrom <{source}>",
            f"  prov:wasGeneratedBy <{activity}>",
            *(f"  schema:keywords {_rdf_literal(topic)}" for topic in entry.topics),
        ]
        triples.append(f"<{entry_iri}> a schema:CreativeWork, pk:JournalEntry, prov:Entity ;\n" + " ;\n".join(properties) + " .")
    activity_properties = [
        f"  prov:used <{source}>",
        *(f"  prov:generated <urn:awp:digital-twin:journal:{entry.id}>" for entry in capture.entries),
        f"  prov:endedAtTime {_rdf_literal(captured_at)}^^xsd:dateTimeStamp",
    ]
    triples.append(f"<{activity}> a prov:Activity ;\n" + " ;\n".join(activity_properties) + " .")
    return "\n".join(
        [
            "PREFIX pk: <urn:voice-agent:personal-knowledge:ontology#>",
            "PREFIX prov: <http://www.w3.org/ns/prov#>",
            "PREFIX schema: <https://schema.org/>",
            "PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>",
            "INSERT DATA { GRAPH <urn:awp:digital-twin:graph:journal> {",
            *(f"  {triple.replace(chr(10), chr(10) + '  ')}" for triple in triples),
            "} }",
            "",
        ]
    )


def _daily_journal_update(capture: DailyJournalCapture) -> str:
    page = f"urn:voice-agent:personal-knowledge:journal:daily:{capture.id}"
    activity = f"urn:voice-agent:personal-knowledge:activity:daily-journal:{capture.id}"
    source_iris = {
        source.source_ref: "urn:voice-agent:codex:message:"
        + hashlib.sha256(source.source_ref.encode("utf-8")).hexdigest()
        for source in capture.sources
    }
    owner_iri = "urn:voice-agent:personal-knowledge:owner:" + hashlib.sha256(
        normalized_identity(capture.identity).encode("utf-8")
    ).hexdigest()
    source_triples = [
        f"<{source_iris[source.source_ref]}> a schema:Message, prov:Entity ;\n"
        + " ;\n".join([
            f"  schema:identifier {_rdf_literal(source.source_ref)}",
            f"  schema:sender <{owner_iri}>",
            f"  schema:text {_rdf_literal(source.transcript)}",
            f"  schema:dateSent {_rdf_literal(source.captured_at.isoformat())}^^xsd:dateTimeStamp",
        ]) + " ."
        for source in capture.sources
    ]
    markdown = [f"# {capture.title}", "", capture.story]
    page_properties = [
        f"  schema:identifier {_rdf_literal(f'codex-daily-journal:{capture.journal_date.isoformat()}:{capture.time_zone}')}",
        f"  schema:name {_rdf_literal(capture.title)}",
        f"  schema:text {_rdf_literal(chr(10).join(markdown))}",
        f"  pk:journalDate {_rdf_literal(capture.journal_date.isoformat())}^^xsd:date",
        f"  pk:timeZone {_rdf_literal(capture.time_zone)}",
        f"  schema:dateCreated {_rdf_literal(capture.captured_at.isoformat())}^^xsd:dateTimeStamp",
        *(f"  prov:wasDerivedFrom <{source_iris[source.source_ref]}>" for source in capture.sources),
        f"  prov:wasGeneratedBy <{activity}>",
    ]
    page_triple = f"<{page}> a pk:DailyJournal, schema:DigitalDocument, prov:Entity ;\n" + " ;\n".join(page_properties) + " ."
    activity_triple = f"<{activity}> a prov:Activity ;\n" + " ;\n".join([
        *(f"  prov:used <{source_iris[source.source_ref]}>" for source in capture.sources),
        f"  prov:generated <{page}>",
        f"  prov:endedAtTime {_rdf_literal(capture.captured_at.isoformat())}^^xsd:dateTimeStamp",
        *([f"  pk:piDurableTaskId {_rdf_literal(capture.task_id)}"] if capture.task_id else []),
    ]) + " ."
    triples = [
        f"<{owner_iri}> a schema:Person, prov:Person ; schema:name \"Owner\" .",
        *source_triples, page_triple, activity_triple,
    ]
    return "\n".join([
        "PREFIX pk: <urn:voice-agent:personal-knowledge:ontology#>",
        "PREFIX prov: <http://www.w3.org/ns/prov#>",
        "PREFIX schema: <https://schema.org/>",
        "PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>",
        f"DELETE WHERE {{ GRAPH <urn:pk:digital-twin:graph:journal> {{ <{page}> ?pagePredicate ?pageObject }} }};",
        f"DELETE WHERE {{ GRAPH <urn:pk:digital-twin:graph:journal> {{ ?entry schema:isPartOf <{page}> ; ?entryPredicate ?entryObject }} }};",
        f"DELETE WHERE {{ GRAPH <urn:pk:digital-twin:graph:journal> {{ <{activity}> ?activityPredicate ?activityObject }} }};",
        "INSERT DATA { GRAPH <urn:pk:digital-twin:graph:journal> {",
        *(f"  {triple.replace(chr(10), chr(10) + '  ')}" for triple in triples),
        "} }",
        "",
    ])


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
    action_iri = f"urn:voice-agent:personal-knowledge:concept:review-action:{feedback.action.replace('_', '-') }"
    actor = "urn:awp:digital-twin:owner:" + hashlib.sha256(feedback.identity.encode("utf-8")).hexdigest()
    status = "deleted" if feedback.action == "delete" else "reviewed"
    replacement_type = feedback.corrected_type or previous_type
    new_kind = replacement_type.replace("_", "-")
    delete_text = "schema:text ?oldText ;" if feedback.corrected_text else ""
    delete_topics = "schema:keywords ?oldTopic ;" if feedback.corrected_topics is not None else ""
    insert_text = (
        f"schema:text {_rdf_literal(feedback.corrected_text)} ;" if feedback.corrected_text else ""
    )
    insert_topics = "\n".join(
        f"    <{entry}> schema:keywords {_rdf_literal(topic)} ."
        for topic in (feedback.corrected_topics or [])
    )
    feedback_properties = [
        f"  schema:identifier {_rdf_literal(event_id)}",
        f"  schema:actionStatus {_rdf_literal(feedback.action)}",
        f"  schema:isBasedOn <{entry}>",
        f"  schema:dateCreated {_rdf_literal(created_at.isoformat())}^^xsd:dateTimeStamp",
        f"  pk:reviewedResource <{entry}>",
        f"  pk:action <{action_iri}>",
        f"  prov:wasAssociatedWith <{actor}>",
        f"  prov:endedAtTime {_rdf_literal(created_at.isoformat())}^^xsd:dateTimeStamp",
        f"  awp:previousType {_rdf_literal(previous_type)}",
        f"  awp:correctedType {_rdf_literal(replacement_type)}",
    ]
    if feedback.corrected_text:
        feedback_properties.append(f"  schema:text {_rdf_literal(feedback.corrected_text)}")
    if feedback.corrected_topics is not None:
        feedback_properties.extend(
            f"  awp:correctedTopic {_rdf_literal(topic)}" for topic in feedback.corrected_topics
        )
    return "\n".join(
        [
            "PREFIX schema: <https://schema.org/>",
            "PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>",
            "PREFIX awp: <urn:awp:digital-twin:predicate:>",
            "PREFIX pk: <urn:voice-agent:personal-knowledge:ontology#>",
            "PREFIX prov: <http://www.w3.org/ns/prov#>",
            "DELETE { GRAPH <urn:awp:digital-twin:graph:journal> {",
            f"  <{entry}> schema:additionalType ?oldType ; pk:journalEntryKind ?oldConcept ; {delete_text} {delete_topics} awp:status ?oldStatus .",
            "} }",
            "INSERT {",
            "  GRAPH <urn:awp:digital-twin:graph:journal> {",
            f"    <{entry}> schema:additionalType {_rdf_literal(replacement_type)} ; pk:journalEntryKind <urn:voice-agent:personal-knowledge:concept:journal-kind:{new_kind}> ; {insert_text} awp:status {_rdf_literal(status)} .",
            insert_topics,
            "  }",
            "  GRAPH <urn:awp:digital-twin:graph:journal-feedback> {",
            f"    <{actor}> a prov:Person .",
            f"    <{event}> a schema:ReviewAction, pk:ReviewEvent, prov:Activity ;",
            "    " + " ;\n    ".join(feedback_properties) + " .",
            "  }",
            "}",
            "WHERE { GRAPH <urn:awp:digital-twin:graph:journal> {",
            f"  <{entry}> schema:additionalType ?oldType .",
            f"  OPTIONAL {{ <{entry}> pk:journalEntryKind ?oldConcept }}",
            f"  OPTIONAL {{ <{entry}> schema:text ?oldText }}",
            f"  OPTIONAL {{ <{entry}> schema:keywords ?oldTopic }}",
            f"  OPTIONAL {{ <{entry}> awp:status ?oldStatus }}",
            "} }",
            "",
        ]
    )


def _assertion_review_update(
    entry_id: str, review: AssertionReview, event_id: str, created_at: datetime
) -> str:
    entry = f"urn:awp:digital-twin:journal:{entry_id}"
    event = f"urn:awp:digital-twin:assertion-review:{event_id}"
    actor = "urn:awp:digital-twin:owner:" + hashlib.sha256(
        normalized_identity(review.identity).encode("utf-8")
    ).hexdigest()
    properties = [
        f"  schema:isBasedOn <{entry}>",
        f"  schema:dateCreated {_rdf_literal(created_at.isoformat())}^^xsd:dateTimeStamp",
        f"  schema:agent {_rdf_literal(normalized_identity(review.identity))}",
        f"  schema:description {_rdf_literal(review.reason.strip())}",
        f"  pk:reviewedResource <{entry}>",
        "  pk:action <urn:voice-agent:personal-knowledge:concept:review-action:review-prediction>",
        f"  prov:wasAssociatedWith <{actor}>",
        f"  prov:endedAtTime {_rdf_literal(created_at.isoformat())}^^xsd:dateTimeStamp",
        f"  awp:ownerAuthored {'true' if review.owner_authored else 'false'}",
    ]
    if review.expected_kind is not None:
        properties.append(f"  awp:expectedKind {_rdf_literal(review.expected_kind)}")
    if review.expected_profile_field is not None:
        properties.append(
            f"  awp:expectedProfileField {_rdf_literal(review.expected_profile_field)}"
        )
    return "\n".join(
        [
            "PREFIX schema: <https://schema.org/>",
            "PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>",
            "PREFIX awp: <urn:awp:digital-twin:predicate:>",
            "PREFIX pk: <urn:voice-agent:personal-knowledge:ontology#>",
            "PREFIX prov: <http://www.w3.org/ns/prov#>",
            "INSERT DATA { GRAPH <urn:awp:digital-twin:graph:assertion-feedback> {",
            f"  <{actor}> a prov:Person .",
            f"  <{event}> a schema:ReviewAction, pk:ReviewEvent, prov:Activity ;",
            "  " + " ;\n  ".join(properties) + " .",
            "} }",
        ]
    )


def _assertion_review_query(entry_id: str) -> str:
    entry = f"urn:awp:digital-twin:journal:{entry_id}"
    return "\n".join(
        [
            "PREFIX schema: <https://schema.org/>",
            "PREFIX awp: <urn:awp:digital-twin:predicate:>",
            "SELECT ?ownerAuthored ?expectedKind ?expectedProfileField ?reason ?reviewedAt WHERE {",
            "  GRAPH <urn:awp:digital-twin:graph:assertion-feedback> {",
            f"    ?review a schema:ReviewAction ; schema:isBasedOn <{entry}> ;",
            "      awp:ownerAuthored ?ownerAuthored ; schema:description ?reason ; schema:dateCreated ?reviewedAt .",
            "    OPTIONAL { ?review awp:expectedKind ?expectedKind }",
            "    OPTIONAL { ?review awp:expectedProfileField ?expectedProfileField }",
            "  }",
            "}",
            "ORDER BY DESC(?reviewedAt)",
            "LIMIT 1",
        ]
    )


def _journal_miss_update(feedback: JournalMissFeedback, event_id: str, created_at: datetime) -> str:
    source = f"urn:awp:digital-twin:journal:{feedback.capture_id}"
    event = f"urn:awp:digital-twin:journal-feedback:{event_id}"
    actor = "urn:awp:digital-twin:owner:" + hashlib.sha256(feedback.identity.encode("utf-8")).hexdigest()
    return "\n".join(
        [
            "PREFIX schema: <https://schema.org/>",
            "PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>",
            "PREFIX awp: <urn:awp:digital-twin:predicate:>",
            "PREFIX pk: <urn:voice-agent:personal-knowledge:ontology#>",
            "PREFIX prov: <http://www.w3.org/ns/prov#>",
            "INSERT DATA { GRAPH <urn:awp:digital-twin:graph:journal-feedback> {",
            f"  <{actor}> a prov:Person .",
            f"  <{event}> a schema:ReviewAction, pk:ReviewEvent, prov:Activity ;",
            f"    schema:identifier {_rdf_literal(event_id)} ;",
            '    schema:actionStatus "missed" ;',
            f"    schema:isBasedOn <{source}> ;",
            f"    schema:dateCreated {_rdf_literal(created_at.isoformat())}^^xsd:dateTimeStamp ;",
            f"    pk:reviewedResource <{source}> ;",
            "    pk:action <urn:voice-agent:personal-knowledge:concept:review-action:missed-entry> ;",
            f"    prov:wasAssociatedWith <{actor}> ;",
            f"    prov:endedAtTime {_rdf_literal(created_at.isoformat())}^^xsd:dateTimeStamp ;",
            f"    awp:correctedType {_rdf_literal(feedback.expected_type)} ;",
            f"    schema:text {_rdf_literal(feedback.expected_text)} .",
            "} }",
            "",
        ]
    )


def _review_update(capture: ReviewCapture) -> str:
    source = f"urn:awp:digital-twin:review-source:{capture.id}"
    classification = capture.classification
    activity = f"urn:awp:digital-twin:activity:classification:{capture.id}"
    decision = f"urn:awp:digital-twin:decision:{capture.id}"
    annotation = f"urn:awp:digital-twin:annotation:{capture.id}"
    agent = "urn:awp:digital-twin:agent:classifier:" + hashlib.sha256(
        classification.model.encode("utf-8")
    ).hexdigest()
    kind_iris = {
        "conversation_topic": "conversation-topic",
        "skill_evidence": "skill-evidence",
        "profile_update": "profile-update",
    }
    profile_field_iris = {
        "job_title": "job-title",
        "home_location": "home-location",
        "credential": "credential",
        "employment": "employment",
        "none": "none",
    }
    inference_triples = [
        f"<{source}> a schema:Message, prov:Entity ;\n"
        + " ;\n".join([
            f"  schema:identifier {_rdf_literal(capture.source_ref)}",
            f"  schema:dateSent {_rdf_literal(capture.captured_at.isoformat())}^^xsd:dateTimeStamp",
            f"  awp:model {_rdf_literal(classification.model)}",
            f"  pk:profileFieldConfidence {classification.profile_field_confidence}",
        ]) + " .",
        f"<{agent}> a prov:SoftwareAgent ; schema:name {_rdf_literal(classification.model)} .",
        f"<{activity}> a pk:ClassificationActivity, prov:Activity ;\n"
        + " ;\n".join([
            f"  prov:used <{source}>",
            f"  prov:wasAssociatedWith <{agent}>",
            f"  pk:modelName {_rdf_literal(classification.model)}",
            f"  prov:endedAtTime {_rdf_literal(capture.captured_at.isoformat())}^^xsd:dateTimeStamp",
        ]) + " .",
    ]
    candidate_triples: list[str] = []
    decision_properties = [
        f"  pk:predictedKind <urn:voice-agent:personal-knowledge:concept:assertion-kind:{kind_iris[classification.kind]}>",
        f"  pk:profileField <urn:voice-agent:personal-knowledge:concept:profile-field:{profile_field_iris[classification.profile_field]}>",
        f"  pk:confidence {classification.confidence}",
        f"  pk:profileFieldConfidence {classification.profile_field_confidence}",
        f"  pk:decisionFor <{source}>",
        f"  prov:wasGeneratedBy <{activity}>",
    ]
    for kind, probability in classification.probabilities.model_dump().items():
        probability_iri = f"{decision}:probability:{kind}"
        kind_iri = kind_iris.get(kind, kind)
        decision_properties.append(f"  pk:hasProbability <{probability_iri}>")
        inference_triples.append(
            f"<{probability_iri}> a pk:ProbabilityAssignment ;\n"
            f"  pk:probabilityFor <urn:voice-agent:personal-knowledge:concept:assertion-kind:{kind_iri}> ;\n"
            f"  pk:probabilityValue {probability} ."
        )
    inference_triples.extend([
        f"<{decision}> a pk:ClassificationDecision, prov:Entity ;\n"
        + " ;\n".join(decision_properties) + " .",
        f"<{annotation}> a oa:Annotation ;\n"
        f"  oa:motivatedBy oa:classifying ;\n"
        f"  oa:hasTarget <{source}> ;\n"
        f"  oa:hasBody <{decision}> ;\n"
        f"  prov:wasGeneratedBy <{activity}> .",
    ])
    for candidate in capture.candidates:
        candidate_iri = f"urn:awp:digital-twin:review:{candidate.id}"
        properties = [
            f"  schema:identifier {_rdf_literal(candidate.id)}",
            f"  schema:additionalType {_rdf_literal(classification.kind)}",
            f"  pk:assertionKind <urn:voice-agent:personal-knowledge:concept:assertion-kind:{kind_iris[classification.kind]}>",
            f"  pk:profileField <urn:voice-agent:personal-knowledge:concept:profile-field:{profile_field_iris[classification.profile_field]}>",
            f"  schema:disambiguatingDescription {_rdf_literal(classification.profile_field)}",
            f"  schema:name {_rdf_literal(candidate.label)}",
            f"  schema:text {_rdf_literal(candidate.evidence_quote)}",
            f"  pk:evidenceQuote {_rdf_literal(candidate.evidence_quote)}",
            f"  schema:isBasedOn <{source}>",
            f"  prov:wasDerivedFrom <{source}>",
            f"  prov:wasGeneratedBy <{activity}>",
            f"  schema:dateCreated {_rdf_literal(capture.captured_at.isoformat())}^^xsd:dateTimeStamp",
            f"  awp:confidence {classification.confidence}",
            f"  awp:lowConfidence {str(classification.low_confidence).lower()}",
            '  awp:status "pending"',
            "  pk:reviewState <urn:voice-agent:personal-knowledge:concept:review-state:pending>",
        ]
        candidate_triples.append(f"<{candidate_iri}> a schema:Claim, pk:CandidateAssertion, prov:Entity ;\n" + " ;\n".join(properties) + " .")
    generated_resources = [decision, annotation, *(f"urn:awp:digital-twin:review:{item.id}" for item in capture.candidates)]
    inference_triples.append(f"<{activity}> prov:generated " + ", ".join(f"<{resource}>" for resource in generated_resources) + " .")
    return "\n".join(
        [
            "PREFIX pk: <urn:voice-agent:personal-knowledge:ontology#>",
            "PREFIX oa: <http://www.w3.org/ns/oa#>",
            "PREFIX prov: <http://www.w3.org/ns/prov#>",
            "PREFIX schema: <https://schema.org/>",
            "PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>",
            "PREFIX awp: <urn:awp:digital-twin:predicate:>",
            "INSERT DATA {",
            "  GRAPH <urn:awp:digital-twin:graph:assertion-classification> {",
            *(f"    {triple.replace(chr(10), chr(10) + '    ')}" for triple in inference_triples),
            "  }",
            "  GRAPH <urn:awp:digital-twin:graph:review> {",
            *(f"    {triple.replace(chr(10), chr(10) + '    ')}" for triple in candidate_triples),
            "  }",
            "}",
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


def _review_decision_update(
    candidate_id: str,
    decision: Literal["accept", "reject"],
    identity: str,
) -> str:
    candidate = f"urn:awp:digital-twin:review:{candidate_id}"
    status = "accepted" if decision == "accept" else "rejected"
    status_iri = f"urn:voice-agent:personal-knowledge:concept:review-state:{status}"
    action_iri = f"urn:voice-agent:personal-knowledge:concept:review-action:{decision}"
    event = f"urn:awp:digital-twin:assertion-review:{uuid4().hex}"
    actor = "urn:awp:digital-twin:owner:" + hashlib.sha256(identity.encode("utf-8")).hexdigest()
    reviewed_at = datetime.now(UTC).isoformat()
    accepted_insert = (
        "GRAPH <urn:awp:digital-twin:graph:accepted> {\n"
        f"  <{candidate}> a schema:Claim, pk:ProfileFact ;\n"
        f"    schema:identifier {_rdf_literal(candidate_id)} ;\n"
        "    schema:additionalType ?kind ; schema:name ?label ; schema:text ?evidence ;\n"
        "    schema:isBasedOn ?source ; prov:wasDerivedFrom ?source ;\n"
        f"    pk:assertionKind ?canonicalKind ; pk:reviewState <{status_iri}> ;\n"
        f"    prov:wasGeneratedBy <{event}> .\n"
        "}"
        if decision == "accept"
        else ""
    )
    return "\n".join(
        [
            "PREFIX schema: <https://schema.org/>",
            "PREFIX awp: <urn:awp:digital-twin:predicate:>",
            "PREFIX pk: <urn:voice-agent:personal-knowledge:ontology#>",
            "PREFIX prov: <http://www.w3.org/ns/prov#>",
            "PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>",
            "DELETE { GRAPH <urn:awp:digital-twin:graph:review> {",
            f"  <{candidate}> awp:status ?oldStatus .",
            f"  <{candidate}> pk:reviewState ?oldReviewState .",
            "} }",
            "INSERT {",
            "  GRAPH <urn:awp:digital-twin:graph:review> {",
            f"    <{candidate}> awp:status {_rdf_literal(status)} ; pk:reviewState <{status_iri}> .",
            "  }",
            "  GRAPH <urn:awp:digital-twin:graph:assertion-feedback> {",
            f"    <{actor}> a prov:Person .",
            f"    <{event}> a schema:ReviewAction, pk:ReviewEvent, prov:Activity ;",
            f"      schema:identifier {_rdf_literal(event.rsplit(':', 1)[-1])} ;",
            f"      schema:actionStatus {_rdf_literal(decision)} ;",
            f"      schema:isBasedOn <{candidate}> ;",
            f"      schema:dateCreated {_rdf_literal(reviewed_at)}^^xsd:dateTimeStamp ;",
            f"      pk:reviewedResource <{candidate}> ; pk:action <{action_iri}> ;",
            f"      prov:wasAssociatedWith <{actor}> ;",
            f"      prov:endedAtTime {_rdf_literal(reviewed_at)}^^xsd:dateTimeStamp .",
            "  }",
            f"  {accepted_insert}",
            "}",
            "WHERE { GRAPH <urn:awp:digital-twin:graph:review> {",
            f"  <{candidate}> awp:status ?oldStatus ; schema:additionalType ?kind ;",
            "    schema:name ?label ; schema:text ?evidence ; schema:isBasedOn ?source .",
            "  OPTIONAL { <" + candidate + "> pk:assertionKind ?candidateKind }",
            "  OPTIONAL { <" + candidate + "> pk:reviewState ?oldReviewState }",
            "  VALUES (?kind ?mappedKind) {",
            '    ("conversation_topic" <urn:voice-agent:personal-knowledge:concept:assertion-kind:conversation-topic>)',
            '    ("skill_evidence" <urn:voice-agent:personal-knowledge:concept:assertion-kind:skill-evidence>)',
            '    ("profile_update" <urn:voice-agent:personal-knowledge:concept:assertion-kind:profile-update>)',
            "  }",
            "  BIND(COALESCE(?candidateKind, ?mappedKind) AS ?canonicalKind)",
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
        except TaskError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/v1/digital-twin/daily-journals", status_code=202)
async def enqueue_daily_journal(
    body: DailyJournalTaskRequest,
    _: None = Depends(authenticate),
):
    with telemetry.observe("digital_twin.daily_journal.enqueue"):
        try:
            return await asyncio.to_thread(
                service().enqueue_daily_journal,
                identity=normalized_identity(body.identity),
                journal_date=body.journal_date.isoformat(),
                time_zone=body.time_zone,
                sources=[{
                    "sourceRef": source.source_ref,
                    "speaker": source.speaker,
                    "capturedAt": source.captured_at.isoformat(),
                    "transcript": source.transcript,
                } for source in body.sources],
            )
        except TaskError as exc:
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


@app.post("/v1/digital-twin/daily-journal")
async def write_digital_twin_daily_journal(
    body: DailyJournalCapture,
    _: None = Depends(authenticate_digital_twin_writer),
):
    normalized_identity(body.identity)
    with telemetry.observe("digital_twin.daily_journal.write"):
        try:
            await asyncio.to_thread(_sparql_update, _daily_journal_update(body))
            return {
                "journalId": body.id,
                "journalDate": body.journal_date.isoformat(),
                "entries": 1,
                "sources": len(body.sources),
            }
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
        body.corrected_type is not None
        or body.corrected_text is not None
        or body.corrected_topics is not None
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


@app.post("/v1/digital-twin/journal/{entry_id}/assertion-review")
async def record_assertion_review(
    entry_id: Annotated[str, ApiPath(pattern=r"^[a-f0-9]{32}:entry:[1-9][0-9]*$")],
    body: AssertionReview,
    _: None = Depends(authenticate),
):
    normalized_identity(body.identity)
    if body.owner_authored:
        if body.expected_kind is None:
            raise HTTPException(
                status_code=422, detail="owner assertion review requires expectedKind"
            )
        if body.expected_kind == "profile_update" and body.expected_profile_field in {None, "none"}:
            raise HTTPException(
                status_code=422, detail="profile update requires expectedProfileField"
            )
        if body.expected_kind != "profile_update" and body.expected_profile_field not in {
            None,
            "none",
        }:
            raise HTTPException(
                status_code=422, detail="non-profile kind cannot have a profile field"
            )
    elif body.expected_kind is not None or body.expected_profile_field is not None:
        raise HTTPException(status_code=422, detail="non-owner source cannot have assertion labels")
    with telemetry.observe("digital_twin.assertion.review"):
        try:
            if not await asyncio.to_thread(_sparql_rows, _journal_entry_query(entry_id)):
                raise HTTPException(status_code=404, detail="journal entry not found")
            event_id = uuid4().hex
            await asyncio.to_thread(
                _sparql_update,
                _assertion_review_update(entry_id, body, event_id, datetime.now(UTC)),
            )
            return {"entryId": entry_id, "reviewId": event_id}
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/v1/digital-twin/journal/{entry_id}/assertion-review")
async def get_assertion_review(
    entry_id: Annotated[str, ApiPath(pattern=r"^[a-f0-9]{32}:entry:[1-9][0-9]*$")],
    identity: str = Query(min_length=3, max_length=320),
    _: None = Depends(authenticate),
):
    normalized_identity(identity)
    with telemetry.observe("digital_twin.assertion.review.read"):
        try:
            rows = await asyncio.to_thread(_sparql_rows, _assertion_review_query(entry_id))
            return {"entryId": entry_id, "review": rows[0] if rows else None}
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
                    _sparql_update,
                    _review_decision_update(candidate_id, body.decision, normalized_identity(body.identity)),
                )
            return {"candidateId": candidate_id, "status": requested}
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/v1/tasks", status_code=201)
async def submit_task(body: TaskSubmissionRequest, _: None = Depends(authenticate)):
    with telemetry.observe("task.submit"):
        trace_context: dict[str, str] = {}
        inject(trace_context)
        try:
            result = await asyncio.to_thread(
                service().submit,
                identity=normalized_identity(body.identity),
                instruction=body.instruction,
                workspace=body.workspace,
                trace_context=trace_context,
            )
            return voice_view(result)
        except (TaskError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail="Pi Durable task owner is unavailable") from exc


@app.get("/v1/tasks")
async def list_tasks(
    identity: str = Query(min_length=3, max_length=320),
    limit: int = Query(default=50, ge=1, le=100),
    session_name: str | None = Query(default=None, min_length=1, max_length=200),
    _: None = Depends(authenticate),
):
    with telemetry.observe("task.list"):
        try:
            results = await asyncio.to_thread(
                service().list,
                identity=normalized_identity(identity),
                limit=limit,
                session_name=session_name,
            )
            return [voice_view(result) for result in results]
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail="Pi Durable task owner is unavailable") from exc


@app.get("/v1/tasks/{task_id}")
async def get_task(
    task_id: str,
    identity: str = Query(min_length=3, max_length=320),
    _: None = Depends(authenticate),
):
    with telemetry.observe("task.get"):
        try:
            result = await asyncio.to_thread(
                service().get,
                identity=normalized_identity(identity),
                task_id=task_id,
            )
            return voice_view(result)
        except TaskError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/v1/tasks/{task_id}/progress")
async def get_task_progress(
    task_id: str,
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
                task_id=task_id,
                after=after,
                limit=limit,
            )
        except TaskError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/v1/tasks/{task_id}/artifacts/{name}")
async def get_task_artifact(
    task_id: str,
    name: Annotated[str, ApiPath(pattern=r"^(workspace|patch)$")],
    identity: str = Query(min_length=3, max_length=320),
    _: None = Depends(authenticate),
):
    with telemetry.observe("task.artifact.read"):
        try:
            content, filename, content_type = await asyncio.to_thread(
                service().artifact,
                identity=normalized_identity(identity),
                task_id=task_id,
                name=name,
            )
        except TaskError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except (ClientError, ValueError) as exc:
            raise HTTPException(status_code=502, detail="task artifact is unavailable") from exc
        return Response(
            content=content,
            media_type=content_type,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )


@app.post("/v1/tasks/{task_id}/cancel")
async def cancel(
    task_id: str,
    body: IdentityRequest,
    _: None = Depends(authenticate),
):
    with telemetry.observe("task.cancel"):
        try:
            result = await asyncio.to_thread(
                service().cancel,
                identity=normalized_identity(body.identity),
                task_id=task_id,
            )
            return voice_view(result)
        except TaskError as exc:
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
