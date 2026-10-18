---
name: digital-twin-oumi
description: Prepare reviewed digital-twin data for Oumi and run or qualify bounded generative SFT, LoRA, or QLoRA experiments. Use only for explicitly approved Oumi work in agent-workload-platform; do not use for Promptfoo-only evaluation, production journal extraction, or Clef joint-head training.
---

# Digital Twin Oumi

Use Oumi only after `$digital-twin-learning-improvement` shows that reviewed prompt, policy, deterministic-rule, model-selection, and annotation work has plateaued and the user explicitly requests training.

## Boundaries

- Oxigraph is the private evidence and human-feedback authority.
- Promptfoo is the product-specific qualification and release gate.
- Oumi analyzes reviewed exports and performs generative SFT, LoRA, or QLoRA.
- OTel receives bounded run signals through the repository-owned wrapper.
- Keep W&B disabled. Oumi's `enable_mlflow` is an integration with an MLflow service, not a replacement for one: leave it off for preparation and smoke tests, and point it at the existing repository MLflow service only when experiment tracking or model versioning is in scope. Registration and aliases still require qualification and explicit promotion decisions.

Never infer gold labels from model output. Never use generic Oumi or TRL SFT for Clef's joint schema head; route that work to `$digital-twin-clef-training`. Do not modify Ansible or production packaging unless explicitly requested.

## Read before execution

Read [references/oumi-workflow.md](references/oumi-workflow.md) for preflight, data preparation, configuration, training, observation, qualification, and packaging. For authorized Oumi autoresearch, also read [../digital-twin-learning-improvement/references/autoresearch.md](../digital-twin-learning-improvement/references/autoresearch.md).

Validate the frozen JSON experiment contract with `../digital-twin-learning-improvement/scripts/validate_experiment_contract.py <contract.json>` before an autoresearch loop.

Inspect the repository Oumi research note, classifier evaluation contract, inference-observability contract, digital-twin README, installed Oumi schema, and pinned dependency version. Official examples are evidence, not automatically valid local configuration.

## Gate sequence

1. **Preflight:** require reviewed export, approval manifest, validator, split integrity, pinned Oumi environment, ignored private root, training recipe, task-specific provider/evaluator, baseline, and inference adapter.
2. **Prepare:** export only reviewed, redacted examples; validate labels, corrections, duplicates, semantic-family isolation, overlap, context, and secrets before `oumi analyze`.
3. **Configure:** validate the resolved configuration and immutable revisions, seeds, dataset digest, artifact identity, explicit resume path, W&B disablement, and the MLflow target when tracking is requested.
4. **Smoke test:** run a disposable two-step test before real compute.
5. **Train:** use the checked-in privacy-enforcing wrapper for real runs; direct CLI is limited to inspection, analysis, and the disposable smoke test.
6. **Qualify:** serve the exact artifact through the task's real inference boundary and run its no-cache Promptfoo suite against the approved baseline.
7. **Package:** merge or quantize only for a named runtime, then repeat qualification and register only the immutable qualified artifact.

Stop at the first missing or failed gate. Oumi validation loss is diagnostic; training success does not qualify, register, promote, or deploy a model.

## Completion

Report the highest gate reached, reviewed dataset and split digests, pinned resolved configuration, smoke/run outcomes, privacy-safe OTel evidence when requested, development and single-use locked-holdout results, final artifact digest, packaging/reload parity, registered immutable version when requested, rollback target, and remaining uncertainty.
