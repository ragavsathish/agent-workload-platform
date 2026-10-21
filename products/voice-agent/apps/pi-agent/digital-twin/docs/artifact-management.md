# Classifier artifact management

DVC versions local reproducibility bundles while Adobe S3Mock provides the development object store.
Git tracks `artifacts.dvc`, the bundle schema, and the remote configuration; it never tracks the
bundle contents. The default remote is the `dvc/digital-twin` prefix in the existing
`agent-artifacts` bucket at `http://127.0.0.1:9090`.

## Ownership

- Oxigraph remains the authority for reviewed labels and feedback.
- Promptfoo remains the qualification and promotion gate.
- DVC stores reviewed dataset/split manifests, training configuration, and aggregate qualification
  evidence during local experiments.
- MLflow owns experiment runs, packaged Clef models, registered-model versions, tags, and aliases.
- S3Mock is disposable development infrastructure, not production durability.
- Hugging Face is optional: it may supply a pinned upstream model or receive an explicitly approved
  promotion, but it is not part of DVC artifact storage or verification.

Each DVC bundle must satisfy `artifact-bundle.schema.json`. Store only reviewed dataset/split
manifests, training configuration, aggregate qualification evidence, and the optional MLflow model
reference. Model weights, the LoRA adapter, and joint schema head belong to the MLflow model
version—not a second DVC copy. Never place transcripts, dataset rows, optimizer state, raw logs,
credentials, private paths, or row-level evaluation output in a DVC bundle.

Register each packaged Clef model under one stable MLflow registered-model name. Every registration
creates an immutable model version linked to its run. Use tags for the Promptfoo status and relevant
digests. Use aliases rather than lifecycle stages: `candidate` may identify the version under final
review, `champion` changes only after explicit promotion, and `rollback` retains the previous
champion. DVC manifests may reference the MLflow name, version, and run ID; they must not use a
mutable alias as reproducibility evidence.

## Local workflow

From `products/voice-agent`:

```bash
make digital-twin-artifact-store
make digital-twin-artifact-add
make digital-twin-artifact-push
make digital-twin-artifact-status
make digital-twin-artifact-verify
make digital-twin-mlflow-verify
```

Replace the contents of `apps/pi-agent/digital-twin/artifacts/`, update `manifest.json`, and run
`digital-twin-artifact-add`. Commit only the resulting `artifacts.dvc` pointer with the related
experiment configuration and code. A checkout can reconstruct the exact evidence bundle with
`make digital-twin-artifact-pull`.

The checked remote contains no credentials. Local commands use the mock-only defaults
`local-test`/`local-test`; environment variables `ARTIFACT_ACCESS_KEY` and `ARTIFACT_SECRET_KEY`
override them. Real S3 credentials must stay in the environment or `.dvc/config.local` and must
never be committed.

The verification target pushes the current pointer, creates an isolated temporary DVC checkout,
pulls the bundle through S3Mock, and byte-compares the fixture. It does not clear the developer's
DVC cache or modify the active artifact directory.

The MLflow verification target starts a loopback-only MLflow 3.17.1 server with a database-backed
registry and proxied artifacts under `s3://agent-artifacts/mlflow`. It registers one harmless
`digital-twin-clef-integration` pyfunc version and assigns only the `integration` alias. It never
assigns `candidate`, `champion`, or `rollback`; those remain explicit release decisions.
