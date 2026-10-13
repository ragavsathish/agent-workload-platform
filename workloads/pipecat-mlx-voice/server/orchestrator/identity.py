"""Trusted identity extraction at the Tailscale Serve boundary."""

from collections.abc import Mapping

from .config import Settings


class IdentityError(PermissionError):
    """Raised when a request has no authorized identity."""


def resolve_identity(
    headers: Mapping[str, str], client_host: str | None, settings: Settings
) -> str:
    identity = headers.get("tailscale-user-login", "").strip().lower()
    if (
        not identity
        and settings.allow_local_dev
        and client_host in {"127.0.0.1", "::1", "testclient"}
    ):
        identity = "local-dev"
    if not identity:
        raise IdentityError("open this application through Tailscale Serve")
    if identity != "local-dev" and not settings.allowed_users:
        raise IdentityError("ORCHESTRATOR_ALLOWED_USERS must be configured for remote access")
    if settings.allowed_users and identity not in {user.lower() for user in settings.allowed_users}:
        raise IdentityError("this tailnet identity is not allowed")
    return identity
