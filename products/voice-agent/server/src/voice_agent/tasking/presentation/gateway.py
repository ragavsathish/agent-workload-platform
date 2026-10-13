"""Narrow host task API for the isolated voice VM.

The gateway deliberately exposes only propose, inspect, approve, and cancel for
the authenticated tailnet identity supplied by the edge. It owns the database
and approval secrets; neither crosses into the VM.
"""

from __future__ import annotations

import asyncio
import json
import os
import secrets
from io import StringIO
from pathlib import Path
from typing import Annotated

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field

from voice_agent.shared.telemetry import configure_telemetry
from voice_agent.tasking.application.pi_response import parse_pi_event_stream, response_from_text
from voice_agent.tasking.application.service import ProposalError, TaskService
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


class IdentityRequest(BaseModel):
    identity: str = Field(min_length=3, max_length=320)


class ProposalRequest(IdentityRequest):
    instruction: str = Field(min_length=1, max_length=20_000)
    workspace: str = Field(min_length=1, max_length=4_096)


async def authenticate(authorization: Annotated[str | None, Header()] = None) -> None:
    expected = f"Bearer {GATEWAY_TOKEN}"
    if authorization is None or not secrets.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="invalid agent gateway credential")


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
            normalized = response_from_text("Legacy task completed; its final response is unavailable.")
        response_text = normalized.text
    else:
        normalized = response_from_text("Task completed.")
        response_text = normalized.text

    public_execution: dict[str, object] = {
        "exit_code": execution.get("exit_code"),
        "response": {
            "text": response_text,
            "spoken": normalized.spoken,
            "mermaid": normalized.mermaid,
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


@app.get("/health")
async def health(_: None = Depends(authenticate)) -> dict[str, str]:
    return {"status": "ok"}


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
    _: None = Depends(authenticate),
):
    with telemetry.observe("task.list"):
        results = await asyncio.to_thread(
            service().list,
            identity=normalized_identity(identity),
            limit=limit,
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
            pending = await asyncio.to_thread(
                tasks.get, identity=identity, proposal_id=proposal_id
            )
            token = pending.get("approval_token")
            if not isinstance(token, str):
                raise ProposalError("proposal is not available for approval")
            result = await asyncio.to_thread(
                tasks.approve,
                identity=identity,
                proposal_id=proposal_id,
                token=token,
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.getenv("AGENT_GATEWAY_HOST", "127.0.0.1"),
        port=int(os.getenv("AGENT_GATEWAY_PORT", "9444")),
        access_log=False,
    )
