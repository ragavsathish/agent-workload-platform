"""Authenticated browser API for task review and control."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from .config import Settings
from .identity import IdentityError, resolve_identity
from .models import ApprovalRequest, ProposalCreate, ProposalView
from .service import ProposalError, TaskService


def create_api_router(settings: Settings | None = None) -> APIRouter:
    configured = settings or Settings.from_env()
    router = APIRouter(prefix="/api", tags=["tasks"])

    def identity(request: Request) -> str:
        try:
            return resolve_identity(
                request.headers,
                request.client.host if request.client else None,
                configured,
            )
        except IdentityError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc

    def service() -> TaskService:
        try:
            return TaskService(configured)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @router.get("/health")
    async def health() -> dict[str, object]:
        try:
            configured.require_api()
            return {"orchestrator": "configured", "queue": configured.queue}
        except RuntimeError as exc:
            return {"orchestrator": "unconfigured", "detail": str(exc)}

    @router.post("/tasks", response_model=ProposalView, status_code=201)
    async def propose(
        body: ProposalCreate,
        user: str = Depends(identity),
        tasks: TaskService = Depends(service),
    ):
        try:
            return await asyncio.to_thread(
                tasks.propose,
                identity=user,
                instruction=body.instruction,
                workspace=body.workspace,
            )
        except (ProposalError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("/tasks", response_model=list[ProposalView])
    async def list_tasks(
        limit: int = Query(default=50, ge=1, le=100),
        user: str = Depends(identity),
        tasks: TaskService = Depends(service),
    ):
        return await asyncio.to_thread(tasks.list, identity=user, limit=limit)

    @router.get("/tasks/{proposal_id}", response_model=ProposalView)
    async def get_task(
        proposal_id: str,
        user: str = Depends(identity),
        tasks: TaskService = Depends(service),
    ):
        try:
            return await asyncio.to_thread(tasks.get, identity=user, proposal_id=proposal_id)
        except ProposalError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.post("/tasks/{proposal_id}/approve", response_model=ProposalView)
    async def approve(
        proposal_id: str,
        body: ApprovalRequest,
        user: str = Depends(identity),
        tasks: TaskService = Depends(service),
    ):
        try:
            result = await asyncio.to_thread(
                tasks.approve,
                identity=user,
                proposal_id=proposal_id,
                token=body.approval_token,
            )
        except ProposalError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return result

    @router.post("/tasks/{proposal_id}/cancel", response_model=ProposalView)
    async def cancel(
        proposal_id: str,
        user: str = Depends(identity),
        tasks: TaskService = Depends(service),
    ):
        try:
            return await asyncio.to_thread(tasks.cancel, identity=user, proposal_id=proposal_id)
        except ProposalError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    return router
