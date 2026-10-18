# Oumi training workflow

Use Oumi only for approved data analysis and model training. Preserve these ownership boundaries:

- Oxigraph is the private evidence and human-feedback authority.
- Promptfoo is the canonical behavioral evaluation and release gate.
- Oumi analyzes reviewed exports and performs SFT, LoRA, or QLoRA.
- The existing OpenTelemetry collector receives bounded run signals through a repository-owned adapter.

Keep W&B disabled and do not add Phoenix or a second evaluation/feedback database. Oumi's `enable_mlflow` sends runs to MLflow; it is not an embedded replacement for MLflow. Leave it disabled for preparation and disposable smoke tests. When real training requires experiment tracking or model versioning, configure it against the existing repository MLflow service rather than adding a second tracker. Oumi validation loss can guide training but cannot qualify a model, and registration or alias changes still require qualification and explicit decisions. Never infer a gold label from untouched model output.

For Cloudflare Clef/Clef-flash classifier fine-tuning, use the `digital-twin-clef-training` skill instead. Clef's frozen backbone, LoRA adapters, joint schema head, and calibration loss are not equivalent to generic Oumi `text_sft` or `TRL_SFT`. Oumi may organize a Clef experiment only when it invokes the reviewed Clef-specific trainer without changing that training contract.

## Start with repository context

From the repository root, read these files when present:

- `products/voice-agent/apps/pi-agent/digital-twin/docs/oumi-skill-research.md` for current Oumi commands, fields, official sources, and documentation caveats;
- `products/voice-agent/apps/pi-agent/digital-twin/docs/classifier-eval-frameworks.md` for Promptfoo ownership and holdout rules;
- `products/voice-agent/apps/pi-agent/digital-twin/docs/inference-observability.md` for the OTLP privacy contract; and
- `products/voice-agent/apps/pi-agent/digital-twin/README.md` for journal and feedback semantics.

Treat checked-in repository commands and schemas as the local source of truth. Oumi is evolving: before installing it, changing a recipe, or relying on an advanced feature, verify the current official Oumi documentation and validate against the pinned installed version. Do not copy a documentation example without schema validation.

When the user requests iterative, autonomous, or autoresearch-style Oumi optimization, also read `.agents/skills/digital-twin-learning-improvement/references/autoresearch.md` from the repository root and follow its bounded experiment contract. Autoresearch does not bypass any gate in this workflow.

Do not modify Ansible or production packaging unless the user explicitly includes that work.

## Gate 1: Preflight

Before spending training compute:

1. Inventory the prerequisites for the requested gate: reviewed-export command, dataset validator, approval manifest, pinned Oumi lock, ignored private root, training recipe, OTel wrapper when observability is requested, task-specific Promptfoo provider/config, locked-holdout manifest, approved baseline, inference adapter, and named deployment target when deployment is requested. Fail closed at the first missing prerequisite; do not substitute an adjacent component.
2. Confirm there is an approved, human-reviewed export. If the repository has no declared readiness policy or the approval manifest does not satisfy it, report dataset readiness and stop before training. Never invent a row-count threshold.
3. Exclude unreviewed journal candidates. Translate `keep`, `edit`, `wrong_type`, `delete`, and `missed` into explicit expected outputs; a reviewed deletion has an empty target.
4. Pin the exact Oumi version and dependency lock in an isolated training environment. Do not add Oumi to the Pi agent's production dependencies merely to run an experiment.
5. Set `DO_NOT_TRACK=1` for every Oumi invocation and keep `enable_wandb: false`. Keep `enable_mlflow: false` for preparation and smoke tests; for an approved tracked training run, set it to true only after validating the existing repository MLflow endpoint, experiment, artifact destination, and privacy contract.
6. Use one canonical private root for datasets, resolved configurations, run outputs, telemetry artifacts, and checkpoints. Verify every path with `git check-ignore --no-index`; stop if any private artifact is not ignored.

The approval manifest must identify the feedback snapshot and its digest, approval provenance and time, exporter and validator versions, counts by feedback action/type/split, pending or excluded row counts, semantic-family disjointness and redaction results, and hashes of every split. Store no raw transcript or corrected text in the manifest.

Prefer the Oumi CLI. Its MCP server is experimental; do not make the workflow depend on it. If the user explicitly requests an MCP experiment, initially limit it to documentation startup, config discovery, validation, preflight, and dry runs. Keep actual execution behind repository wrappers.

## Gate 2: Prepare and analyze data

The private exporter, not Oumi, must:

- atomize mixed transcript turns;
- apply the latest human feedback;
- redact identifying or secret content;
- emit only the context needed for the decision;
- assign stable opaque example and semantic-family identifiers;
- keep every semantic family wholly within train, development, or locked-test; and
- freeze and hash the dataset/split manifest.

Emit local Oumi `text_sft` JSONL with `messages` and bounded non-identifying metadata. Run the repository validator before `oumi analyze`. Reject unknown labels, malformed corrections, duplicates, cross-split families, normalized overlap, unapproved context, and identity or credential leakage.

Use `oumi analyze` for conversation shape, lengths, empty turns, and installed-schema checks. It does not establish semantic correctness. Stop when a high-severity dataset test fails; do not silently filter failures into a training run.

## Gate 3: Configure and train

Start from a recipe for the exact model family, copy it into the repository's experiment area, and validate it with the pinned Oumi package. Keep model revision, tokenizer revision, seeds, dataset manifest digest, exporter version, and output artifact identity explicit.

Use a development split for training feedback. Keep the locked Promptfoo holdout out of Oumi training and model selection. Default to adapter-only LoRA for the first bounded experiment; choose QLoRA only when hardware constraints justify its additional quantization variables.

Before a real run:

1. load the YAML through the installed Oumi configuration schema;
2. inspect the resolved configuration;
3. run a two-step smoke test in a disposable private output directory; and
4. resolve any schema, model-family, tokenizer, precision, or device error.

Then run the immutable config without unrecorded command-line overrides. A real training run must use a checked-in repository wrapper that enforces `DO_NOT_TRACK=1`, disables unapproved external tracking, configures only the approved existing MLflow target when tracking is in scope, validates private paths, and activates the requested bounded OTel contract. If that wrapper is absent or untested, stop before real training; direct CLI remains acceptable only for schema inspection, dataset analysis, and the explicitly disposable two-step smoke test with the same privacy environment enforced. Use explicit checkpoint paths for resumes so a stale output directory cannot silently alter the experiment. Training success alone is not task completion.

### Bounded Oumi autoresearch

Use autoresearch only after an explicit training request, completed preflight, an approved immutable dataset/evaluator baseline, and evidence that prompt, policy, deterministic-rule, model-selection, and annotation work has plateaued on a persistent reviewed error slice.

Freeze the objective, mutable configuration fields, immutable dataset/evaluator, primary metric, safety gates, minimum meaningful delta, repetitions/seeds, resource budget, and stop conditions before the loop. Use one attributable hypothesis per candidate. Validate and smoke-test every candidate, eliminate weak candidates with comparable short development runs, repeat finalists to measure variance, and spend the full budget only on justified finalists.

The loop may vary only approved training configuration or data-mixture fields. It must not change locked-holdout data, labels, evaluator code, privacy controls, model/task family, deployment format, or qualification thresholds after seeing results. Training loss and Oumi evaluation are diagnostic; choose the development incumbent using the task-specific product metrics through the real inference boundary plus every predeclared safety gate.

Log every attempt, including discarded, invalid, crashed, and timed-out candidates, with immutable configuration, data, code, seed, checkpoint, metric, variance, duration, resource, and report digests. Keep detailed ledgers private and ignored. Never use destructive Git resets in a shared worktree; isolate experiments and revert only experiment-owned files.

Stop at the declared budget, plateau, resource limit, repeated failure, or gate violation. Freeze the best development candidate before qualification. Autoresearch never opens the locked holdout during the loop and never registers, aliases, packages, deploys, or uploads a candidate automatically.

## Gate 4: Observe and qualify

Use the lightweight repository `oumi-otel` adapter. It should wrap, not patch, Oumi:

- one root span per train or evaluate attempt;
- child events or spans only for validation, checkpoint, failure, and completion;
- metric observations for loss, evaluation loss, learning rate, throughput, duration, MFU, memory, and invalid numeric values; and
- bounded attributes or hashes for versions, configuration, dataset manifest, base model, method, and final artifact.

Do not create a span for every step. Never export transcript text, prompts, completions, corrections, evidence, dataset rows, private paths, checkpoint content, credentials, or high-cardinality identifiers to OTel.

If OTel observation is part of the request and the adapter is absent or its privacy contract is untested, stop before real training. Do not satisfy the request with Oumi's local telemetry files alone.

Serve the exact candidate artifact through the same bounded inference contract as the corresponding Promptfoo provider. Run the task-specific Promptfoo suite with cache disabled and compare it with the approved baseline. A classifier suite is not a substitute for a journal-extractor suite, or vice versa. If the relevant provider, locked holdout, or baseline is absent, stop at qualification readiness rather than claiming the checkpoint is better.

Journal-extractor qualification must cover structured entry types and text, empty targets for reviewed deletions, missed-entry recall, false-memory precision, semantic-family paraphrase stability, schema/contract validity, latency, and resource behavior where supported. Classifier qualification must retain the repository's multiclass precision/recall/F1, false-durable, calibration/Brier, review, and probability-contract measures.

Oumi's own evaluator may supply supplementary generic benchmarks. It never replaces Promptfoo's product-specific go/no-go decision.

## Gate 5: Package deliberately

Keep adapter-only output during experiments. Merge, bundle a base model, or quantize only for a named deployment target after the unquantized candidate passes Promptfoo. A deployment request is actionable only when it identifies the target runtime, required artifact form, exact qualified digest, rollback plan, and post-packaging verification. Ask for the missing deployment choice rather than inferring it. Re-run the same no-cache Promptfoo qualification against the exact merged or quantized artifact because packaging can change behavior.

Record immutable hashes for configuration, environment, dataset manifest, base model, adapter/checkpoint, packaging step, and Promptfoo report. Promotion requires an explicit decision; never deploy automatically from training success.

## Completion

Report the gate reached and any failed gate. A complete training experiment has:

- a reviewed and privacy-validated dataset manifest;
- a pinned, validated configuration and reproducible run manifest;
- a successful bounded smoke test and training run;
- privacy-safe OTel evidence when the adapter is in scope;
- a no-cache Promptfoo comparison against the locked holdout; and
- an explicitly chosen artifact form for the target runtime.

A completed Oumi autoresearch session additionally has a frozen experiment contract, complete candidate ledger, bounded resource accounting, variance-aware development comparison, best candidate digest, rejected hypotheses, and a recorded stopping reason. It is not a completed qualification until the separately authorized locked-holdout comparison passes.

If the request covers only preparation or readiness, stop at that gate and return the evidence instead of starting training.
