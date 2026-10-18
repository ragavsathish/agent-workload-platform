# Oumi workflow and repository skill research

Research date: 2026-10-18

## Decision

Use Oumi as a local, version-pinned **data-analysis and model-training tool** for the digital twin.
Keep the repository's current authority boundaries intact:

- **Oxigraph** is the authority for private transcripts, journal entries, and human feedback.
- **Promptfoo** is the canonical behavioral evaluation and checkpoint release gate.
- **Oumi** analyzes an approved export and performs SFT/LoRA/QLoRA training.
- **OpenTelemetry** receives a bounded operational summary through a small repository-owned adapter.

Do not make Oumi's evaluator or judge a second release gate. Its validation loss is useful during
training, and its judges may help triage a dataset, but neither turns model output into a gold label.
Do not add MLflow, W&B, or another tracking database.

Oumi is not installed in the current workspace. Introduce it in an isolated, pinned Python
environment when the first training experiment is approved rather than adding it to the Pi agent's
production package.

The official repository's current release page identifies v0.9 as the latest release as of this
research date, and the project still describes advanced features as actively evolving
([v0.9 release](https://github.com/oumi-ai/oumi/releases/tag/v0.9),
[repository](https://github.com/oumi-ai/oumi)). Pin the exact resolved package and lockfile; do not
install from the moving `main` branch or use an unpinned container tag.

## Why this boundary fits Oumi

Oumi's public CLI includes `train`, `evaluate`, `infer`, `judge`, `synth`, `analyze`, `tune`, and
`quantize`. There is no dedicated `curate` command; curation is assembled from analysis,
deterministic filtering, optional judging, and an explicit export
([quickstart](https://github.com/oumi-ai/oumi/blob/main/docs/get_started/quickstart.md?plain=1),
[judge framework](https://oumi.ai/docs/en/latest/user_guides/judge/judge.html)). For this repository,
the explicit export must begin with reviewed Oxigraph feedback. Oumi must never scrape the complete
journal graph or infer approval from an untouched candidate.

Oumi recommends `TextSftJsonLinesDataset`, registered as `text_sft`, for text chat data. Each JSONL
row contains a `messages` array with `system`, `user`, and `assistant` roles, and may carry metadata
([chat formats](https://oumi.ai/docs/en/latest/resources/datasets/data_formats.html)). This maps
cleanly to an atomic reviewed transcript plus its corrected structured result:

```json
{"messages":[{"role":"system","content":"Extract only durable owner-authored journal entries as the required JSON schema."},{"role":"user","content":"I learned that retries create duplicate spans."},{"role":"assistant","content":"{\"entries\":[{\"type\":\"learning\",\"text\":\"Retries create duplicate spans.\"}]}"}],"metadata":{"semanticFamilyId":"family-opaque","labelSource":"owner-reviewed","split":"train"}}
```

The private exporter, not Oumi, should construct this row. It must atomize mixed turns, apply the
latest `keep`/`edit`/`wrong_type`/`delete`/`missed` feedback, redact identifiers, assign the whole
semantic family to one split, and freeze a manifest before training. A reviewed deletion becomes an
empty `entries` target. An unreviewed candidate is excluded.

## Dataset preparation and analysis

Start with a local JSONL export and a checked-in analysis configuration:

```yaml
dataset_path: /private/approved/train.jsonl
output_path: /private/oumi-runs/dataset-analysis

analyzers:
  - id: length
    type: length
    display_name: Length
    params:
      tokenizer_name: Qwen/Qwen2.5-3B-Instruct
  - id: quality
    type: quality
    display_name: Quality
  - id: turns
    type: turn_stats
    display_name: Turns

tests:
  - id: empty_turns
    type: threshold
    metric: quality.has_empty_turns
    operator: "=="
    value: true
    max_percentage: 0
    severity: high
```

Run it locally:

```bash
DO_NOT_TRACK=1 oumi analyze --config configs/analyze.yaml --format json \
  --output /private/oumi-runs/dataset-analysis
```

`oumi analyze` reports length, turn structure, empty messages, invalid serialized values, and other
conversation-shape checks. It writes per-conversation analysis plus `test_results.json` and
`summary.json`; `oumi analyze --list-metrics` prints the installed version's available fields
([dataset analysis](https://oumi.ai/docs/en/latest/user_guides/analyze/analyze.html),
[analysis configuration](https://oumi.ai/docs/en/latest/user_guides/analyze/analyze_config.html)).

These built-ins do not establish this product's semantic correctness. Before analysis, a
repository-owned validator must also reject:

- unknown feedback status or journal type;
- missing corrected content for edits and misses;
- duplicate example IDs or semantic families crossing splits;
- evidence that is not attributable to an owner turn;
- raw identity fields, secrets, credentials, or non-approved transcript context; and
- train/dev/test content overlap after normalization.

Oumi supports custom analyzers registered in Python, including message-, conversation-, dataset-,
and preference-level analyzers. Add one only when the rule benefits more than this exporter; keep
privacy and split-integrity checks in the repository's pre-export validator so they run without
Oumi too ([custom analyzer API](https://oumi.ai/docs/en/latest/user_guides/analyze/analyze.html#writing-custom-analyzers)).

Oumi's `SimpleJudge`, `RubricJudge`, and experimental `RuleBasedJudge` can help rank ambiguous rows,
and all may run against local inference. A rubric call evaluates criteria together, which is cheaper
but makes the criteria non-independent; a separate simple judge is appropriate when independence
matters. Treat all judge output as a review suggestion, not a label
([judge framework](https://oumi.ai/docs/en/latest/user_guides/judge/judge.html),
[judge configuration](https://oumi.ai/docs/en/latest/user_guides/judge/judge_config.html)). Promptfoo's
already-calibrated Selene path remains the normal semantic-review mechanism, so the first Oumi skill
should omit judging unless a human explicitly requests dataset triage.

## Reproducible SFT, LoRA, and QLoRA

Begin from an Oumi recipe that matches the exact model family, copy it into the repository, and
validate it with the installed Oumi version. The YAML structure is `model`, `data`, `training`,
`peft`, and optional distributed sections; command-line overrides use dotted fields
([training guide](https://oumi.ai/docs/en/latest/user_guides/train/train.html),
[training configuration](https://oumi.ai/docs/en/latest/user_guides/train/configuration.html)). A
minimal repository candidate is:

```yaml
model:
  model_name: /private/models/qwen-base
  model_max_length: 2048
  torch_dtype_str: bfloat16
  attn_implementation: sdpa
  load_pretrained_weights: true
  trust_remote_code: false

data:
  train:
    datasets:
      - dataset_name: text_sft
        dataset_path: /private/approved/train.jsonl
        shuffle: true
        seed: 4242
  validation:
    datasets:
      - dataset_name: text_sft
        dataset_path: /private/approved/dev.jsonl

training:
  trainer_type: TRL_SFT
  use_peft: true
  output_dir: /private/oumi-runs/journal-lora-001
  run_name: journal-lora-001
  seed: 4242
  data_seed: 4242
  use_deterministic: true
  num_train_epochs: 3
  per_device_train_batch_size: 2
  per_device_eval_batch_size: 2
  gradient_accumulation_steps: 8
  learning_rate: 2.0e-5
  eval_strategy: epoch
  save_epoch: true
  save_final_model: true
  logging_strategy: steps
  logging_steps: 10
  log_examples: false
  include_performance_metrics: true
  enable_tensorboard: false
  enable_wandb: false
  enable_mlflow: false
  telemetry:
    telemetry_dir: telemetry
    collect_telemetry_for_all_ranks: false
    track_gpu_temperature: false

peft:
  lora_r: 16
  lora_alpha: 32
  lora_dropout: 0.05
  lora_target_modules: null
  q_lora: false
  peft_save_mode: adapter_only
```

For QLoRA, change only the reviewed recipe's PEFT/precision settings, for example:

```yaml
peft:
  q_lora: true
  q_lora_bits: 4
  bnb_4bit_quant_type: nf4
  use_bnb_nested_quant: true
  bnb_4bit_compute_dtype: bfloat16
```

Oumi documents LoRA fields including `lora_r`, `lora_alpha`, `lora_dropout`, target modules, and
Q-LoRA's bit and BitsAndBytes settings. `training.use_peft` selects PEFT; `trainer_type: TRL_SFT`
selects supervised fine-tuning
([configuration API](https://oumi.ai/docs/en/latest/api/oumi.core.configs.html)). Target modules and
precision remain model- and hardware-specific: use a same-family recipe and a tiny smoke run rather
than assuming the sample above fits every Qwen release.

Run a bounded smoke test before a real job:

```bash
DO_NOT_TRACK=1 oumi train --config configs/train.yaml \
  --training.max_steps 2 \
  --training.output_dir /private/oumi-runs/smoke
```

Then run the immutable config without ad-hoc overrides:

```bash
DO_NOT_TRACK=1 oumi train --config configs/train.yaml
```

For reproducibility, save and hash the exact YAML, Oumi version, Python/package environment, base
model revision/digest, tokenizer revision, exporter version, dataset/split manifest digests, seed,
hardware summary, and resulting adapter/checkpoint files. Oumi writes training metrics, the full
configuration, environment and package versions under `training.output_dir`; its seed and
deterministic fields reduce variance, but its API explicitly warns that deterministic mode does not
guarantee complete reproducibility
([monitoring](https://oumi.ai/docs/en/latest/user_guides/train/monitoring.html),
[configuration API](https://oumi.ai/docs/en/latest/api/oumi.core.configs.html)). Repeat at least one
small run when reproducibility itself matters.

Use `training.resume_from_checkpoint` for an explicit resume, or
`try_resume_from_last_checkpoint: true` to search `output_dir`. Prefer the explicit path in the
skill so a stale checkpoint cannot silently join a new experiment. Oumi documents that
`save_steps` takes precedence when both step and epoch saving are enabled
([configuration API](https://oumi.ai/docs/en/latest/api/oumi.core.configs.html)).

## Checkpoint, export, and quantization boundary

`peft.peft_save_mode` has three relevant outcomes:

- `adapter_only` is the default and smallest artifact, but it is not self-contained; loading may
  use a separately cached or downloaded base model.
- `adapter_and_base_model` places both in the output directory.
- `merged` saves a standard Transformers model and preserves a copy of the adapter in `adapter/`,
  but the merged model is no longer a PEFT model.

These modes are defined by Oumi's current PEFT API
([PEFT save modes](https://oumi.ai/docs/en/latest/api/oumi.core.configs.params.html#oumi.core.configs.params.peft_params.PeftSaveMode)).
Keep `adapter_only` through experimentation. Merge only after the adapter passes Promptfoo and a
deployment target requires a self-contained Transformers model.

Oumi's separate `oumi quantize` command is marked under active development. The current guide
documents AWQ and BitsAndBytes outputs as `safetensors` and explicitly says GGUF is not implemented,
despite stale mentions elsewhere on the page. Quantization also requires a GPU
([quantization guide](https://oumi.ai/docs/en/latest/user_guides/quantization.html)). Therefore:

1. qualify the unquantized adapter/merged checkpoint with Promptfoo;
2. quantize a copy using a versioned config;
3. re-run the same Promptfoo locked holdout against the exact quantized artifact; and
4. keep quantization out of the initial skill path until the target runtime and format are known.

## Lightweight OTel adapter

Oumi already emits local artifacts that are suitable adapter inputs. `MetricsLoggerCallback` writes
one JSON object per logging step with loss, learning rate, epoch, and optional MFU. The
`TelemetryCallback` records microstep/step/epoch timing, GPU statistics, and distributed summaries
([callback API](https://oumi.ai/docs/en/latest/api/oumi.core.callbacks.html),
[monitoring](https://oumi.ai/docs/en/latest/user_guides/train/monitoring.html)). Oumi does not
document a native OTLP exporter.

The repository-owned `oumi-otel` launcher should wrap the CLI instead of patching Oumi:

```text
oumi-otel run configs/train.yaml
  ├─ root span: one training attempt
  ├─ child events/spans: validation, checkpoint, failure, completion
  ├─ bounded metrics: loss, eval loss, learning rate, throughput, duration, MFU,
  │                  peak device memory, NaN/Inf count, checkpoint count
  └─ local artifacts: exact config, JSONL metrics, Oumi telemetry, checkpoint
```

The adapter should consume/tail Oumi's local metric files at `training.logging_steps`, not emit one
span per step. OTLP attributes may include hashes or bounded identifiers for Oumi version, config,
dataset manifest, base model, method, and final artifact. Transcripts, prompts, completions,
corrections, evidence, dataset rows, filesystem paths, checkpoint contents, credentials, and
high-cardinality run IDs stay out of OTel. Detailed files remain in the ignored private run
directory.

Oumi also has anonymous PostHog usage analytics enabled by default. Its documentation says these
include commands, success/failure, performance, environment, and stack traces, though not data,
weights, outputs, paths, or usernames. Set `DO_NOT_TRACK=1` on every repository-owned Oumi command
so the only telemetry emitted is the allow-listed OTLP contract
([Oumi usage telemetry](https://oumi.ai/docs/en/latest/about/telemetry.html)). Set
`enable_wandb: false`, `enable_mlflow: false`, and use local model/dataset paths. For a strict
offline run, pre-stage the base model and tokenizer, then execute with network disabled; Oumi's
ability to accept local dataset and model paths is documented, but the docs do not promise that an
arbitrary recipe is network-free
([dataset sources](https://oumi.ai/docs/en/latest/resources/datasets/datasets.html),
[model parameters](https://oumi.ai/docs/en/latest/api/oumi.core.configs.params.html)).

## Promptfoo qualification remains canonical

Oumi's `training.eval_strategy` and validation split are for training feedback and early model
selection. They do not replace the repository's semantic-family holdout, deterministic safety
assertions, classifier metrics, calibrated Selene diagnostics, or release thresholds.

After any candidate checkpoint is produced:

1. expose the exact local checkpoint through the same bounded inference contract used by the
   Promptfoo provider;
2. run the checked-in Promptfoo suite with cache disabled;
3. compare false durable memories, precision/recall/F1, Brier/calibration, paraphrase variance,
   contract validity, latency, and resource use to the approved baseline;
4. store only aggregate results and the private report digest on the Oumi run span; and
5. require an explicit promotion decision.

Oumi's own `evaluate` command may be used for generic external benchmarks, but it is supplementary.
Promptfoo owns the product-specific go/no-go decision.

## MCP assessment

No official Codex/Agent Skills `SKILL.md` is published in the Oumi repository. Oumi's agent-facing
workflow material is instead delivered through its MCP guidance resources. That makes a small
repository-specific skill useful: it can preserve this project's Promptfoo, Oxigraph, privacy, and
OTel boundaries while consulting Oumi's current schemas.

Oumi ships an experimental stdio MCP server through `pip install "oumi[mcp]"`. It can search the
bundled recipe library, return a config, validate a local config, run pre-flight checks, launch jobs
in dry-run mode, and monitor jobs. Its documentation says the assistant must call `get_started`
first, and distinguishes read-only bundled configs from local path-sensitive configs
([MCP guide](https://oumi.ai/docs/en/latest/user_guides/mcp.html)).

The first repository skill should **not depend on Oumi MCP**. The CLI and checked-in configs are
easier to pin, review, and reproduce, while the MCP API is explicitly experimental. If enabled
later, limit it initially to `get_started`, config discovery, `validate_config`, and
`pre_flight_check`. Copy an inspected recipe into the repository; never launch a bundled config by
name. Keep real execution behind the repository wrapper so `DO_NOT_TRACK=1`, private paths, OTLP
allow-listing, and Promptfoo qualification cannot be bypassed.

## Documentation caveats discovered

The skill must validate against the installed package rather than copying documentation examples
blindly:

- the training guide's simplified PEFT snippet contains `peft_method: lora`, while the current
  `PeftParams` API lists LoRA fields and `training.use_peft` but no `peft_method` field;
- the monitoring page places `model.model_max_length` under `training` in one MFU example, although
  the main schema places `model` at the top level; and
- the quantization guide mentions a default `.gguf` output in its parameter section but says GGUF
  is not implemented and lists only `safetensors` as supported.

These inconsistencies are a strong reason to pin Oumi, run the installed command's `--help`, load
the YAML through `TrainingConfig.from_yaml`, and perform a two-step smoke run before spending GPU
time.

## Recommended skill design

Create one model-invoked repository skill named `digital-twin-oumi`. Its description should trigger
on preparing reviewed digital-twin data for Oumi, analyzing an Oumi dataset, configuring or running
SFT/LoRA/QLoRA, resuming/exporting/quantizing an Oumi checkpoint, or observing Oumi training through
OTLP. The body should use five checkable phases:

1. **Preflight:** read this note and the current digital-twin README/evaluation/observability docs;
   verify Oumi is version-pinned, `DO_NOT_TRACK=1`, private paths are ignored, and the task has an
   approved reviewed export.
2. **Dataset:** export only reviewed Oxigraph records, validate privacy and semantic-family splits,
   run `oumi analyze`, and stop if any high-severity test fails.
3. **Train:** derive a same-family recipe, validate the installed schema, hash inputs, run two smoke
   steps, then run the immutable local YAML with the OTLP wrapper.
4. **Qualify:** serve the exact artifact locally and run Promptfoo's no-cache locked holdout. Oumi
   training success alone is never completion.
5. **Package:** after qualification, choose adapter, self-contained, merged, or quantized output for
   the named deployment target and record digests; promotion remains explicit.

Keep detailed field reference in this research note rather than duplicating it in `SKILL.md`. The
skill should point here for the Oumi-specific branch and use repository commands/scripts as the
source of truth once they exist. Completion means a reviewed dataset manifest, reproducible run
manifest, bounded OTel evidence, and Promptfoo comparison are all present—not merely that
`oumi train` exited successfully.
