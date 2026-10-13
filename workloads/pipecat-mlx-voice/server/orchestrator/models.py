"""API models."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class ProposalCreate(BaseModel):
    instruction: str = Field(min_length=1, max_length=20_000)
    workspace: str = Field(min_length=1, max_length=4_096)


class ApprovalRequest(BaseModel):
    approval_token: str = Field(min_length=32, max_length=4_096)


class ProposalView(BaseModel):
    id: str
    identity: str
    instruction: str
    workspace: str
    plan_hash: str
    status: str
    task_id: str | None
    created_at: datetime
    expires_at: datetime
    approval_token: str | None = None
    result: object | None = None
