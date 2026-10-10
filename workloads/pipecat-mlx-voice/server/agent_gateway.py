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
from pathlib import Path
from typing import Annotated

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field

from orchestrator.config import Settings
from orchestrator.service import ProposalError, TaskService

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


def voice_view(result: dict[str, object]) -> dict[str, object]:
    """Remove host approval capabilities and bound task output for voice."""
    view = dict(result)
    view.pop("approval_token", None)
    task_result = view.get("result")
    if task_result is not None:
        rendered = json.dumps(task_result, default=str, ensure_ascii=True)
        view["result"] = rendered[:12_000]
        view["result_truncated"] = len(rendered) > 12_000
    return view


def service() -> TaskService:
    return TaskService(settings)


@app.get("/health")
async def health(_: None = Depends(authenticate)) -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/tasks", status_code=201)
async def propose(body: ProposalRequest, _: None = Depends(authenticate)):
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


@app.get("/v1/tasks/{proposal_id}")
async def get_task(
    proposal_id: str,
    identity: str = Query(min_length=3, max_length=320),
    _: None = Depends(authenticate),
):
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
    identity = normalized_identity(body.identity)
    try:
        tasks = service()
        pending = await asyncio.to_thread(tasks.get, identity=identity, proposal_id=proposal_id)
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
