import time

import pytest
from voice_agent.tasking.domain.approval import (
    ApprovalError,
    mint_approval,
    plan_hash,
    verify_approval,
)

SECRET = "s" * 32


def test_approval_is_bound_to_identity_and_plan() -> None:
    digest = plan_hash({"instruction": "test", "workspace": "/work"})
    token = mint_approval(
        proposal_id="proposal-1",
        identity="me@example.com",
        digest=digest,
        expires_at=int(time.time()) + 60,
        secret=SECRET,
    )

    claims = verify_approval(token, identity="me@example.com", secret=SECRET)
    assert claims.proposal_id == "proposal-1"
    assert claims.plan_hash == digest

    with pytest.raises(ApprovalError, match="another identity"):
        verify_approval(token, identity="attacker@example.com", secret=SECRET)


def test_tampering_and_expiry_are_rejected() -> None:
    token = mint_approval(
        proposal_id="proposal-1",
        identity="me@example.com",
        digest="a" * 64,
        expires_at=100,
        secret=SECRET,
    )
    payload, signature = token.split(".")

    with pytest.raises(ApprovalError, match="signature"):
        verify_approval(
            f"{payload}.{signature[:-1]}A", identity="me@example.com", secret=SECRET, now=1
        )
    with pytest.raises(ApprovalError, match="expired"):
        verify_approval(token, identity="me@example.com", secret=SECRET, now=101)
