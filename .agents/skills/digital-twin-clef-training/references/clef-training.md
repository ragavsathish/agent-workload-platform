# Clef training contract

Use this reference only after an explicit Clef training request and a completed `$digital-twin-learning-improvement` readiness assessment.

## Preflight

Require an owner-reviewed SystemOne export and approval manifest, a request-plus-label validator, semantic-family-disjoint train/development/locked-test manifests, a pinned Clef revision and dependency lock, an ignored private run root, a reviewed Clef-specific trainer, an untouched Clef baseline on the locked holdout, and a local inference adapter that loads the joint head plus LoRA.

When persistence is requested, require a configured DVC remote and isolated push/pull verification. When model versioning is requested, require the repository's database-backed MLflow registry and artifact store. When observability is requested, require the tested bounded OTel wrapper. Stop rather than substituting an adjacent component.

The experiment manifest must identify the persistent reviewed error slice, failed prompt hypotheses, primary objective, safety gates, operational limits, incumbent production baseline, untouched Clef baseline, mutable training fields, seeds, and stop conditions.

## Dataset and trainer

Each private row must contain the exact typed SystemOne decision input, a legal human label, opaque semantic-family identity, split, owner-review status, source kind, error slice, and prompt/criteria/ontology provenance. Atomize mixed turns, apply final adjudication, redact identities and secrets, reject normalized duplicates across splits, and keep every semantic family in one split.

The trainer must load the pinned official backbone, processor, joint schema head, and SystemOne encoding contract; freeze the backbone except for explicitly targeted LoRA adapters; train the joint head and approved LoRA parameters; record trainable and total parameter counts; save adapter, joint-head, optimizer, scheduler, config, environment, and digest manifests; and resume only from an explicit checkpoint path.

Treat label-smoothed cross-entropy plus a weighted Brier calibration term as the repository's current experimental default, not a universal Clef requirement. Pin its weights in the experiment config and verify the loss contract against the reviewed trainer and model revision. Do the same for LoRA ranks, target modules, optimizer settings, imbalance handling, and stopping policy.

## Observe and stop safely

Use one root span per attempt, bounded validation/checkpoint/failure/completion events, and metric observations at the configured interval. Export only bounded versions, hashes, outcomes, durations, loss/calibration aggregates, throughput, memory, numeric-health, and trainable-parameter signals. Never export row content, prompts, labels, criteria prose, transcripts, identities, private paths, credentials, checkpoints, or per-run identifiers as metric labels.

Stop on invalid numeric values, invalid trainable-parameter scope, corrupted checkpoints, privacy failure, or a declared compute/resource limit. Development objectives may drive early stopping; the locked Promptfoo holdout may not.

## Qualify through production behavior

Reload the exact adapter plus joint head through the SystemOne-compatible endpoint. Run Promptfoo with cache disabled and compare against both the incumbent production baseline and untouched Clef baseline. Include per-class precision/recall/F1, false durable rate, review coverage, Brier score, log loss, calibration, probability-contract validity, robustness, latency, resource behavior, and all predeclared safety gates.

Reject a candidate that improves the primary metric while violating any gate. Machine-judge output and training loss remain diagnostic. Freeze the best development candidate before the single authorized locked-holdout evaluation.

## Package and version

Keep adapter and joint head separate during experiments. Merge or quantize only for a named runtime after the unmodified candidate qualifies, then verify reload parity and repeat the same no-cache suite against the packaged artifact.

DVC stores approved dataset/split manifests, training config, aggregate qualification evidence, and the immutable MLflow model/run reference. It must not duplicate the registered model artifact or contain raw rows, optimizer state, credentials, private paths, or row-level output. Verify a clean temporary `dvc pull`; S3Mock validates the local workflow but is not durable production storage.

Register the qualified adapter plus joint head under one stable MLflow model name. Tag the immutable version with base-model, code, training-config, DVC-pointer, and Promptfoo-report digests. Use mutable aliases only operationally: `candidate` for review, `champion` after explicit promotion, and `rollback` for the prior champion. Reproducibility always names the immutable version, never an alias.
