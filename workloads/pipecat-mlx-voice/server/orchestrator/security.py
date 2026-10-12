"""Identity-bound, short-lived approval capabilities."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Any


class ApprovalError(ValueError):
    """Raised when an approval capability is invalid."""


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def plan_hash(plan: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(plan)).hexdigest()


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


@dataclass(frozen=True)
class ApprovalClaims:
    proposal_id: str
    identity: str
    plan_hash: str
    expires_at: int


def mint_approval(
    *, proposal_id: str, identity: str, digest: str, expires_at: int, secret: str
) -> str:
    payload = canonical_json(
        {"exp": expires_at, "identity": identity, "plan_hash": digest, "proposal_id": proposal_id}
    )
    signature = hmac.new(secret.encode(), payload, hashlib.sha256).digest()
    return f"{_encode(payload)}.{_encode(signature)}"


def verify_approval(
    token: str, *, identity: str, secret: str, now: int | None = None
) -> ApprovalClaims:
    try:
        encoded_payload, encoded_signature = token.split(".", 1)
        payload = _decode(encoded_payload)
        signature = _decode(encoded_signature)
        expected = hmac.new(secret.encode(), payload, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected):
            raise ApprovalError("invalid approval signature")
        data = json.loads(payload)
        claims = ApprovalClaims(
            proposal_id=str(data["proposal_id"]),
            identity=str(data["identity"]),
            plan_hash=str(data["plan_hash"]),
            expires_at=int(data["exp"]),
        )
    except ApprovalError:
        raise
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ApprovalError("malformed approval capability") from exc

    if not hmac.compare_digest(claims.identity, identity):
        raise ApprovalError("approval belongs to another identity")
    if claims.expires_at < (now if now is not None else int(time.time())):
        raise ApprovalError("approval capability expired")
    return claims
