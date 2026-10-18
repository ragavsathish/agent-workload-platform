---
name: digital-twin-clef-training
description: Prepare, train, qualify, package, and version a Cloudflare Clef or Clef-flash SystemOne classifier using its joint schema head and LoRA adapters. Use only after reviewed prompt and annotation work has plateaued and training is explicitly requested; do not use for generic generative SFT or journal prompt improvement.
---

# Digital Twin Clef Training

Train the Clef architecture only after the learning-improvement evidence gate passes. Clef is not generic text generation: its frozen backbone, LoRA adapters, joint schema head, and calibrated probabilities require a reviewed Clef-specific trainer.

## Boundaries

- Oxigraph remains the human-label authority.
- Promptfoo remains the product qualification and release gate.
- DVC versions reviewed dataset manifests and reproducibility evidence.
- MLflow owns experiment runs, packaged model artifacts, immutable registered-model versions, tags, and aliases.
- OTel receives bounded run signals through the repository adapter.
- Hugging Face tooling may fetch only pinned model revisions into a private cache.

Never substitute generic TRL `SFTTrainer` or Oumi `TRL_SFT`. Never upload private datasets, optimizer state, row-level output, transcripts, or journal content. Do not modify Ansible, promote an alias, deploy, merge, quantize, or upload without the separately required decision.

## Read before execution

Read [references/clef-training.md](references/clef-training.md) for preflight, trainer, observation, qualification, and artifact requirements. For classifier scorecards, also read [../digital-twin-learning-improvement/references/metrics.md](../digital-twin-learning-improvement/references/metrics.md). For authorized training autoresearch, read [../digital-twin-learning-improvement/references/autoresearch.md](../digital-twin-learning-improvement/references/autoresearch.md).

Validate a reviewed SystemOne JSONL export with `scripts/validate_systemone_dataset.py <dataset.jsonl>` before training. Treat automated privacy detection as a lower bound that does not replace owner review.

Verify the current official Clef model card and source at the exact pinned revision before relying on model internals or installing dependencies.

## Gate sequence

1. **Readiness:** require reviewed data, split integrity, privacy checks, an untouched Clef baseline, evidence of prompt/policy plateau, an explicit training hypothesis, pinned code and model revisions, a reviewed custom trainer, and a local inference adapter.
2. **Validation:** validate the dataset, trainable-parameter scope, environment, configuration, private ignored paths, DVC persistence when requested, and MLflow/OTel connectivity when in scope.
3. **Smoke test:** run a CPU/tiny-model contract when available and a two-step disposable run before real compute.
4. **Train:** update only approved LoRA and joint-head parameters; preserve explicit seeds, configs, checkpoints, digests, and resume paths.
5. **Qualify:** reload the exact artifact through the SystemOne-compatible inference boundary and run the no-cache Promptfoo suite against the approved baseline.
6. **Package:** verify export/reload parity, rerun qualification after merge or quantization, and register only a qualified immutable artifact.

Stop at the first unmet gate and return a readiness report. Training success is not qualification, registration is not promotion, and promotion is not deployment.

## Completion

Report the highest completed gate, pinned model/trainer/environment, dataset and split digests, smoke/run outcome, trainable-parameter evidence, checkpoint digest, privacy-safe OTel evidence when requested, untouched baseline and candidate Promptfoo reports, reload parity, MLflow version when registered, rollback target, and remaining uncertainty.
