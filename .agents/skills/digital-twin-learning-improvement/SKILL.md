---
name: digital-twin-learning-improvement
description: Improve the agent-workload-platform SystemOne classifier or cognitive-journal extractor through reviewed annotation, prompt or policy iteration, bounded autoresearch, and task-specific evaluation. Use before considering training; do not use for executing Clef or Oumi fine-tuning.
---

# Digital Twin Learning Improvement

Improve behavior with evidence before adding a training lifecycle. Keep the two production branches separate:

- SystemOne is a calibrated decision classifier whose labels require owner review.
- The cognitive journal is a grounded structured extractor for owner-approved thoughts, ideas, questions, decisions, goals, and learnings.

## Ownership and safety

- Oxigraph is the private evidence, feedback, and human-label authority.
- Promptfoo is the canonical classifier behavioral evaluation and release gate. The journal uses its dedicated extraction, repeated-run, and paraphrase harnesses.
- Git owns prompts, criteria, ontology, scorers, configurations, and non-sensitive aggregate baselines.
- DVC versions reviewed private dataset manifests and reproducibility evidence; Git stores only DVC pointers and safe aggregate metadata.
- OpenTelemetry receives bounded aggregate signals, never transcript, journal, evidence, correction, identity, secret, private-path, or row-level content.
- MLflow may compare prompt experiments, but it is not the authority for prompts, labels, feedback, or journal entries.

Do not modify Ansible. Do not start a trainer, create checkpoints, register a model, deploy, or upload to the Hub from a prompt, annotation, evaluation, or autoresearch request.

## Read the applicable contract

Inspect the repository's digital-twin README, current runtime boundary, evaluator, tests, and relevant documentation before changing behavior.

- For metrics, telemetry, scorecards, stopping rules, or qualification, read [references/metrics.md](references/metrics.md).
- For journal annotation, prompting, feedback, or evaluation, read [references/journal-extraction.md](references/journal-extraction.md).
- For an iterative or autonomous experiment loop, read [references/autoresearch.md](references/autoresearch.md). Autoresearch automates an authorized phase; it does not authorize a later phase.
- Validate a frozen JSON autoresearch contract with `scripts/validate_experiment_contract.py <contract.json>` before the first candidate.

## Choose one mode

1. **Classifier annotation:** curate owner-reviewed labels, provenance, disagreement reasons, semantic families, and fixed error slices.
2. **Classifier improvement:** change one attributable prompt, criterion, threshold, ontology, or deterministic boundary and evaluate it through the production decision boundary.
3. **Journal improvement:** use reviewed keep/delete/edit/wrong-type feedback and explicit misses to improve filtering, examples, grounding, type assignment, or output quality.
4. **Bounded autoresearch:** optimize only the declared mutable prompt, policy, model-selection, or deterministic-rule surface on development and challenge data.
5. **Training readiness:** determine whether persistent reviewed errors justify handoff to `$digital-twin-clef-training` or `$digital-twin-oumi`; do not start training.

Never combine classifier and journal rows, labels, metrics, semantic families, or holdouts.

## Required readiness

Before an improvement experiment, require:

- an immutable incumbent configuration and aggregate baseline;
- current prompt, criteria, ontology, scorer, threshold, model, and code digests as applicable;
- owner-reviewed labels or feedback with provenance;
- semantic-family-disjoint development, challenge, and locked-holdout manifests;
- privacy and secret checks for production-derived examples; and
- one declared objective, fixed error slice, safety gates, operational limits, and rollback target.

Stop with a readiness report when labels are unreviewed, families cross splits, production and evaluation boundaries differ, private paths are not ignored, or the baseline lacks fair-comparison provenance.

## Improvement loop

Use development and challenge data to diagnose one reviewed failure family. Make the smallest attributable change, run deterministic contracts before model-backed evaluation, measure variance where inference is stochastic, and compare product metrics plus every declared safety gate. Machine judges are diagnostic only.

Do not inspect or tune against the locked holdout. Evaluate a frozen candidate there once for a promotion decision. If holdout examples are opened for diagnosis, retire that holdout version before further optimization.

Prompt or policy promotion requires an improved declared objective, no material per-class or safety regression, and a preserved rollback configuration. Training is justified only after several scoped prompt/policy experiments plateau and the residual errors plausibly require learned parameters rather than clearer policy, better labels, threshold selection, or deterministic validation. Training still requires an explicit user request.

## Completion

Report the highest completed gate, immutable baseline and candidate digests, reviewed coverage, split/privacy checks, development results, variance, safety-gate results, any single-use holdout result, rollback target, and remaining uncertainty. For autoresearch, also report the frozen contract, complete append-only candidate ledger, resource spend, best development candidate, rejected hypotheses, and stopping reason.

For independent behavioral review, use the cases in [tests/forward-test-cases.md](tests/forward-test-cases.md).
