from pathlib import Path

import pytest

from orchestrator.config import Settings
from orchestrator.identity import IdentityError, resolve_identity


def settings(*, allowed_users: tuple[str, ...] = ()) -> Settings:
    return Settings(
        database_url="",
        approval_secret="",
        allowed_users=allowed_users,
        workspace_roots=(Path("/tmp"),),
        allow_local_dev=True,
        approval_ttl_seconds=300,
        queue="agents",
        pi_binary="pi",
        pi_model=None,
        pi_thinking="medium",
        pi_session_dir=Path("/tmp/sessions"),
        gondolin_extension=None,
        allow_unsandboxed=False,
        task_timeout_seconds=60,
        max_output_bytes=1024,
    )


def test_remote_identity_requires_an_explicit_allowlist() -> None:
    with pytest.raises(IdentityError, match="must be configured"):
        resolve_identity({"tailscale-user-login": "me@example.com"}, "127.0.0.1", settings())
    assert (
        resolve_identity(
            {"tailscale-user-login": "ME@example.com"},
            "127.0.0.1",
            settings(allowed_users=("me@example.com",)),
        )
        == "me@example.com"
    )


def test_local_development_does_not_trust_remote_clients() -> None:
    assert resolve_identity({}, "127.0.0.1", settings()) == "local-dev"
    with pytest.raises(IdentityError, match="Tailscale Serve"):
        resolve_identity({}, "100.64.0.2", settings())
