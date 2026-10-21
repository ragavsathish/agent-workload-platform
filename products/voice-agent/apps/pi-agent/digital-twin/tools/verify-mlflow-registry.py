#!/usr/bin/env python3
"""Create or reuse a harmless MLflow model version to verify the local registry."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import mlflow
from mlflow import MlflowClient
from mlflow.exceptions import MlflowException


MODEL_NAME = "digital-twin-clef-integration"
ALIAS = "integration"


class FixtureModel(mlflow.pyfunc.PythonModel):
    def predict(
        self,
        context: mlflow.pyfunc.PythonModelContext,
        model_input: list[str],
        params: dict[str, object] | None = None,
    ) -> list[str]:
        return model_input


def main() -> None:
    project_dir = Path(__file__).resolve().parent.parent
    fixture = project_dir / "artifacts" / "fixture.txt"
    digest = hashlib.sha256(fixture.read_bytes()).hexdigest()
    tracking_uri = os.environ.get("MLFLOW_TRACKING_URI", "http://127.0.0.1:5001")

    mlflow.set_tracking_uri(tracking_uri)
    client = MlflowClient(tracking_uri=tracking_uri)
    try:
        client.create_registered_model(MODEL_NAME)
    except MlflowException as error:
        if "already exists" not in str(error):
            raise

    versions = client.search_model_versions(f"name='{MODEL_NAME}'")
    matching = next(
        (version for version in versions if version.tags.get("awp.fixture.sha256") == digest),
        None,
    )
    if matching is None:
        mlflow.set_experiment("digital-twin-clef-integration")
        with mlflow.start_run(run_name="registry-s3mock-roundtrip") as run:
            mlflow.set_tags(
                {
                    "awp.purpose": "integration-fixture",
                    "awp.qualification.status": "not-applicable",
                    "awp.fixture.sha256": digest,
                }
            )
            mlflow.pyfunc.log_model(
                name="model",
                python_model=FixtureModel(),
                input_example=["dvc-s3mock-poc"],
                registered_model_name=MODEL_NAME,
            )
            run_id = run.info.run_id
        versions = client.search_model_versions(f"name='{MODEL_NAME}'")
        matching = next(version for version in versions if version.run_id == run_id)
        client.set_model_version_tag(MODEL_NAME, matching.version, "awp.fixture.sha256", digest)

    client.set_registered_model_alias(MODEL_NAME, ALIAS, matching.version)
    resolved = client.get_model_version_by_alias(MODEL_NAME, ALIAS)
    if resolved.version != matching.version:
        raise SystemExit("MLflow alias did not resolve to the expected model version")

    print(
        f"MLflow registry verified: models:/{MODEL_NAME}/{matching.version} "
        f"(alias {ALIAS})"
    )


if __name__ == "__main__":
    main()
