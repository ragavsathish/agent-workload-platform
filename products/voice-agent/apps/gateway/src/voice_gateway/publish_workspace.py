"""Publish one committed Git workspace to the local artifact store."""

from __future__ import annotations

import argparse
from pathlib import Path

from dotenv import load_dotenv
from voice_agent.tasking.infrastructure.artifacts import ArtifactStore, validate_workspace_name
from voice_agent.tasking.infrastructure.config import Settings


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace")
    parser.add_argument("repository", type=Path)
    args = parser.parse_args()
    load_dotenv(override=True)
    settings = Settings.from_env()
    if not settings.artifact_workspaces:
        raise SystemExit("ARTIFACT_ENDPOINT_URL is not configured")
    validate_workspace_name(args.workspace, settings.allowed_workspaces)
    store = ArtifactStore(
        endpoint_url=settings.artifact_endpoint_url,
        bucket=settings.artifact_bucket,
        access_key=settings.artifact_access_key,
        secret_key=settings.artifact_secret_key,
    )
    uri = store.publish_workspace(args.workspace, args.repository)
    print(uri)


if __name__ == "__main__":
    main()
