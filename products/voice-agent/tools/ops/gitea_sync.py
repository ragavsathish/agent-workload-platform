"""Idempotently provision Gitea identities and publish the committed repository."""

from __future__ import annotations

import base64
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY_ROOT = Path(
    subprocess.run(
        ["git", "-C", str(ROOT), "rev-parse", "--show-toplevel"],
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()
)
REPOSITORY = REPOSITORY_ROOT.name
OWNER = "source-publisher"
ENDPOINT = "http://127.0.0.1:3001"
SECRETS = ROOT / "deploy/secrets"
COMPOSE = [
    "docker",
    "compose",
    "--env-file",
    str(ROOT / "deploy/.env"),
    "-f",
    str(ROOT / "deploy/compose.yml"),
]


def run(
    args: list[str], *, check: bool = True, env: dict[str, str] | None = None
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, check=check, text=True, capture_output=True, env=env)


def secret(name: str) -> str:
    path = SECRETS / name
    if not path.is_file() or path.stat().st_size == 0:
        raise SystemExit(f"Missing generated Gitea secret: {path}")
    return path.read_text(encoding="utf-8").strip()


def atomic_write(path: Path, value: str) -> None:
    temporary = path.with_name(f"{path.name}.part")
    temporary.write_text(f"{value}\n", encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(path)


def request(
    path: str,
    *,
    authorization: str,
    method: str = "GET",
    data: dict[str, Any] | None = None,
) -> Any:
    body = json.dumps(data).encode() if data is not None else None
    headers = {"Authorization": authorization}
    if body is not None:
        headers["Content-Type"] = "application/json"
    with urllib.request.urlopen(
        urllib.request.Request(f"{ENDPOINT}{path}", data=body, headers=headers, method=method),
        timeout=10,
    ) as response:
        content = response.read()
    return json.loads(content) if content else None


def basic(username: str, password: str) -> str:
    encoded = base64.b64encode(f"{username}:{password}".encode()).decode()
    return f"Basic {encoded}"


def ensure_user(username: str, password: str, *, admin: bool = False) -> None:
    command = [
        *COMPOSE,
        "exec",
        "-T",
        "gitea",
        "gitea",
        "admin",
        "user",
        "create",
        "--username",
        username,
        "--password",
        password,
        "--email",
        f"{username}@localhost.invalid",
        "--must-change-password=false",
    ]
    command.append("--admin" if admin else "--restricted")
    created = run(command, check=False)
    if created.returncode != 0:
        run(
            [
                *COMPOSE,
                "exec",
                "-T",
                "gitea",
                "gitea",
                "admin",
                "user",
                "change-password",
                "--username",
                username,
                "--password",
                password,
            ]
        )


def token_is_valid(value: str) -> bool:
    try:
        request("/api/v1/user", authorization=f"token {value}")
    except urllib.error.HTTPError:
        return False
    return True


def ensure_token(username: str, name: str, scopes: str) -> str:
    token_path = SECRETS / f"gitea-{name}-token"
    scopes_path = SECRETS / f"gitea-{name}-token.scopes"
    if token_path.is_file() and scopes_path.is_file():
        candidate = token_path.read_text(encoding="utf-8").strip()
        if scopes_path.read_text(encoding="utf-8").strip() == scopes and token_is_valid(candidate):
            return candidate
    result = run(
        [
            *COMPOSE,
            "exec",
            "-T",
            "gitea",
            "gitea",
            "admin",
            "user",
            "generate-access-token",
            "--username",
            username,
            "--token-name",
            f"{username}-{int(time.time())}",
            "--scopes",
            scopes,
            "--raw",
        ]
    )
    value = result.stdout.strip()
    if not value:
        raise SystemExit(f"Gitea did not issue a token for {username}")
    atomic_write(token_path, value)
    atomic_write(scopes_path, scopes)
    return value


def publish_repository(password: str) -> None:
    authorization = basic(OWNER, password)
    try:
        request(
            "/api/v1/user/repos",
            authorization=authorization,
            method="POST",
            data={"name": REPOSITORY, "private": False, "has_actions": True},
        )
    except urllib.error.HTTPError as error:
        if error.code != 409:
            raise
    current_branch = run(
        ["git", "-C", str(REPOSITORY_ROOT), "symbolic-ref", "--quiet", "--short", "HEAD"]
    ).stdout.strip()
    branches = {"main", current_branch}
    environment = os.environ.copy()
    environment.update(
        {
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "http.extraHeader",
            "GIT_CONFIG_VALUE_0": f"Authorization: {authorization}",
        }
    )
    run(
        [
            "git",
            "-C",
            str(REPOSITORY_ROOT),
            "push",
            "--quiet",
            "--force",
            f"{ENDPOINT}/{OWNER}/{REPOSITORY}.git",
            *(f"refs/heads/{branch}:refs/heads/{branch}" for branch in sorted(branches)),
        ],
        env=environment,
    )


def configure_repositories(password: str, base_image_pull_token: str) -> None:
    authorization = basic(OWNER, password)
    registration = request(
        "/api/v1/admin/actions/runners/registration-token",
        authorization=authorization,
        method="POST",
    )
    registration_token = registration.get("token") if registration else None
    if not registration_token:
        raise SystemExit("Gitea did not return an instance runner registration token")
    atomic_write(SECRETS / "gitea-runner-registration-token", registration_token)
    repositories = request(f"/api/v1/users/{OWNER}/repos?limit=100", authorization=authorization)
    for repository in repositories:
        name = repository["name"]
        prefix = f"/api/v1/repos/{OWNER}/{name}"
        request(
            prefix,
            authorization=authorization,
            method="PATCH",
            data={"has_actions": True},
        )
        try:
            request(
                f"{prefix}/collaborators/image-builder",
                authorization=authorization,
                method="DELETE",
            )
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
        try:
            request(
                f"{prefix}/actions/secrets/IMAGE_BUILDER_TOKEN",
                authorization=authorization,
                method="DELETE",
            )
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
        request(
            f"{prefix}/actions/secrets/IMAGE_BASE_PULL_TOKEN",
            authorization=authorization,
            method="PUT",
            data={
                "data": base_image_pull_token,
                "description": "Pulls private base images for host Docker builds",
            },
        )
        request(
            f"{prefix}/collaborators/workflow-dispatcher",
            authorization=authorization,
            method="PUT",
            data={"permission": "admin"},
        )


def main() -> None:
    publisher_password = secret("gitea-admin-password")
    users = [
        (OWNER, publisher_password, True),
        ("workflow-dispatcher", secret("gitea-dispatcher-password"), False),
        ("voice-agent", secret("gitea-agent-password"), False),
    ]
    for username, password, admin in users:
        ensure_user(username, password, admin=admin)
    run(
        [
            *COMPOSE,
            "exec",
            "-T",
            "gitea",
            "gitea",
            "admin",
            "user",
            "must-change-password",
            "--all",
            "--unset",
        ]
    )
    ensure_token(
        "voice-agent",
        "agent",
        "public-only,read:repository,read:issue,read:user,read:organization",
    )
    base_image_pull_token = ensure_token("image-builder", "builder", "read:package,read:user")
    ensure_token("workflow-dispatcher", "dispatcher", "write:repository,read:user")
    publish_repository(publisher_password)
    configure_repositories(publisher_password, base_image_pull_token)
    print(f"Published committed Git state to {ENDPOINT}/{OWNER}/{REPOSITORY}.git")


if __name__ == "__main__":
    main()
