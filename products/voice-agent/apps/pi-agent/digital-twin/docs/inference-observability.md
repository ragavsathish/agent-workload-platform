# Open-source inference observability for the digital twin

Research date: 2026-10-18

## Decision

Do not replace Promptfoo, Oxigraph, or the existing OpenTelemetry stack. Standardize production
inference spans with the Apache-2.0
[OpenInference conventions](https://github.com/Arize-ai/openinference/blob/main/LICENSE), retain
privacy-safe traces in the existing collector and Tempo path, and periodically run the Apache-2.0
[Evidently](https://github.com/evidentlyai/evidently) library over reviewed classifier records.

This gives the repository the two kinds of observability it needs without adding another system of
record:

- per-request causality in OpenTelemetry traces; and
- population-level probability, label, error, and drift analysis in an offline batch.

Keep the current ownership boundaries:

- **Promptfoo** owns reproducible pre-release model and prompt regression tests;
- **OpenTelemetry, Tempo, Prometheus, and Grafana** own production operations and trace
  correlation;
- **Oxigraph** owns private source text, journal entries, and human feedback;
- **Evidently** may derive periodic aggregate classifier-quality reports from reviewed private
  records; and
- **Oumi** is introduced only later for dataset curation or training, not production
  observability.

Do not add MLflow, Phoenix, or another inference database. Oumi training and evaluation should
emit a small set of OpenTelemetry signals into the collector that the repository already operates.
Oumi remains an occasional training process rather than a second observability control plane.

## Existing system and the actual gap

The repository already exports OTLP traces to Tempo, metrics to Prometheus, and logs to Loki through
one local collector
([collector configuration](../../../../deploy/observability/otelcol-config.yaml)). The journal
pipeline deliberately exposes only bounded counts and outcomes through telemetry; transcripts,
entry text, identities, and capture IDs stay out of metrics. Human `keep`, `delete`, `edit`,
`wrong_type`, and `missed` events are kept in a private Oxigraph graph
([digital-twin design](../README.md#journal-observation-and-feedback)).

Promptfoo already evaluates the bounded classifier with exact labels, probability-contract checks,
Brier score, precision, recall, F1, and safety-weighted metrics. Its local judge remains diagnostic,
while reviewed labels remain authoritative
([evaluation framework](classifier-eval-frameworks.md)).

The missing capabilities are therefore narrower than “install an LLM observability platform”:

1. correlate a production decision with its model, prompt/extractor version, threshold, latency,
   and subsequent feedback;
2. analyze probability and class distributions over time;
3. measure realized quality once reviewed labels arrive; and
4. promote selected failures into the private Promptfoo corpus without making model output its own
   ground truth.

## Recommended event contract

Instrument the System One call as one OpenInference `DECISION` span. The current OpenInference
specification defines this span specifically for classifiers, routers, guardrails, and other models
that return typed probability distributions rather than text. It standardizes requested and
resolved model names, provider/system, token counts, and raw structured request/response fields
([Decision spans](https://arize-ai.github.io/openinference/spec/decision_spans.html)).

Use the standard fields where they fit and bounded application attributes for the product decision:

| Signal | Suggested representation | Retention rule |
| --- | --- | --- |
| Span kind | `openinference.span.kind=DECISION` | Normal trace retention |
| API/model | `decision.system`, `decision.provider`, `decision.request.model_name`, `decision.response.model_name` | Normal trace retention |
| Code identity | `service.version`, `digital_twin.extractor.version`, prompt/schema hash | Normal trace retention |
| Result | selected kind, selected profile field, review boolean, threshold, bounded probability vector | Trace store only; never metric labels |
| Operations | latency, error status, token counts, candidate count | Trace plus aggregate metrics |
| Correlation | random opaque inference ID | Trace and private graph |
| Source text | transcript, evidence, journal text | Oxigraph/private dataset only |
| Human result | keep/edit/delete/wrong-type/missed and corrected label | Oxigraph; attach only bounded annotation to a trace |

OpenInference also defines human, LLM, and code annotations with labels, scores, explanations, and
stable evaluator identifiers. Prompt-template versions are part of the semantic convention
([semantic conventions](https://github.com/Arize-ai/openinference/blob/main/spec/semantic_conventions.md),
[annotations](https://github.com/Arize-ai/openinference/blob/main/spec/annotations.md)). Use the
bounded label and score fields, but do not export explanations when they can contain transcript
content.

Do not place a transcript or raw JSON request/response in `input.value` or `output.value` merely
because the standard permits it. OpenTelemetry attributes are copied into observability storage and
are subject to attribute-size limits
([OpenInference annotation guidance](https://github.com/Arize-ai/openinference/blob/main/spec/annotations.md)).
For this private system, an opaque join ID plus bounded model
metadata is enough for production tracing; an authenticated offline job can join that ID to
Oxigraph when it constructs an evaluation row.

The resulting improvement loop is:

```text
local inference
  ├─ bounded OpenInference DECISION span ──> OTel Collector ──> Tempo/Grafana
  └─ private transcript + prediction ─────> Oxigraph
                                                │
owner feedback ─────────────────────────────────┘
                                                │
                              reviewed private export
                                  ├─> Promptfoo regression
                                  ├─> Evidently batch report
                                  └─> Oumi training later
```

## Lightweight OpenTelemetry bridge for Oumi

Oumi's built-in `TelemetryCallback` collects step, epoch, GPU, and timing information and writes
JSON artifacts. Its `MetricsLoggerCallback` writes training metrics as JSONL at each configured
logging step. The documented integrations are TensorBoard and W&B rather than OTLP
([monitoring guide](https://oumi.ai/docs/en/latest/user_guides/train/monitoring.html),
[callback API](https://www.oumi.ai/docs/en/latest/api/oumi.core.callbacks.html)). Do not introduce a
tracking platform merely to transport these values.

Add a small repository-owned `oumi-otel` launcher/adapter with two responsibilities:

1. wrap `oumi train` or `oumi evaluate` in one root span and record the immutable run identity,
   command kind, configuration hash, dataset revision, base model, seed, method, adapter type,
   start/end time, outcome, and output artifact digest; and
2. consume Oumi's bounded callback metrics and export low-cardinality OTLP metrics to the existing
   collector at the configured logging interval.

Do not create a span for every training step. Export step observations as histograms or gauges and
create child spans only for epochs, validation runs, checkpoint saves, and failures. Suggested
signals are `oumi.train.loss`, `oumi.eval.loss`, learning rate, tokens/second, step duration, epoch
duration, peak device memory, MFU, NaN/Inf count, checkpoint count, and final Promptfoo holdout
scores. Dataset rows, prompts, completions, transcripts, corrected text, local paths, and checkpoint
contents must not be attributes or metric labels.

Oumi's output directory already contains its configuration, environment/package versions,
training logs, and artifacts for reproducibility
([training monitoring](https://oumi.ai/docs/en/latest/user_guides/train/monitoring.html)). Keep those
files as the detailed local record. OpenTelemetry should contain only the bounded operational index
and artifact hashes needed to correlate a run with its subsequent Promptfoo qualification.

## Candidate comparison

| Candidate | Licence and private operation | OpenTelemetry fit | Feedback/evaluation | Classifier calibration and drift | Burden and verdict |
| --- | --- | --- | --- | --- | --- |
| Existing OTel + OpenInference | OpenInference is Apache-2.0 and all data can remain in the current local backends. | Native: OpenInference is an AI semantic convention over valid OTLP traces. It includes prompt versions, annotations, and dedicated decision-model attributes ([specification](https://github.com/Arize-ai/openinference/blob/main/spec/README.md)). | It transports annotations but is not a dataset or review UI. Keep those records in Oxigraph and use Promptfoo. | Store bounded probability fields on spans and derive aggregates separately; do not create high-cardinality Prometheus labels. | **Adopt first.** It adds a portable contract with no new service. |
| Evidently | Apache-2.0 Python library; runs as one-off local reports or a self-hosted monitoring service ([repository](https://github.com/evidentlyai/evidently)). | Not the trace backbone; consume an offline joined table. | Supports reports, tests, custom metrics, and both predictive and generative tasks. It does not replace the existing feedback graph. | Strongest candidate here for tabular classification, per-label performance, log loss, ROC AUC, thresholds, and distribution drift; its current metric catalogue is authoritative ([metric catalogue](https://docs.evidentlyai.com/metrics/all_metrics)). Brier, ECE, and reliability charts should remain repository-owned custom metrics until their current support is confirmed. | **Add later as a scheduled library job**, not an always-on platform. |
| MLflow | Apache-2.0 ([repository](https://github.com/mlflow/mlflow)). | Accepts OTLP and has a broad lifecycle UI. | Duplicates the existing trace, feedback, evaluation, and artifact responsibilities. | Generic rather than classifier-specific. | **Rejected for this design.** The lightweight Oumi OTLP adapter avoids another service and database. |
| Phoenix + OpenInference | Phoenix is self-hostable with SQLite by default and PostgreSQL for scale, but is ELv2 rather than OSI-approved ([self-hosting](https://arize.com/docs/phoenix/self-hosting/deploying-phoenix), [licence](https://github.com/Arize-ai/phoenix/blob/main/docs/phoenix/self-hosting/license.mdx)). | Excellent native OpenTelemetry/OpenInference trace UI. | Versioned datasets can receive production spans and reviewed examples ([datasets](https://arize.com/docs/phoenix/learn/datasets-and-experiments/datasets-concepts)). Annotations may be categorical, continuous, or free-form and may come from humans, LLMs, or code; annotations propagate into datasets ([annotations](https://arize.com/docs/phoenix/tracing/concepts-tracing/annotations-concepts)). | Decision spans preserve the probabilities, but calibration and temporal drift still need custom analysis. Phoenix documentation points continuous online evaluation and alerting to commercial Arize AX ([evaluation](https://arize.com/docs/phoenix/evaluation/llm-evals/evaluator-traces)). | **Best focused UI POC if ELv2 is acceptable.** Do not describe it as strict OSS. |
| Langfuse | Core is MIT, except its `ee` folders; OSS can be self-hosted and telemetry can be disabled ([repository](https://github.com/langfuse/langfuse), [self-hosted telemetry](https://langfuse.com/self-hosting/security/telemetry)). | Native OTel ingestion and OTel-based SDKs. | Strong prompt versioning, scores, datasets, experiments, and human annotation; evaluators receive input, output, expected output, and metadata ([experiment model](https://langfuse.com/docs/evaluation/experiments/data-model)). | No classifier-native probability calibration or drift advantage over the existing evaluator. | **Do not add now.** Production v4 needs web and worker services plus PostgreSQL, Redis/Valkey, ClickHouse, and blob storage; the documented minima are substantial for this private pipeline ([sizing](https://langfuse.com/self-hosting/configuration/scaling)). |
| OpenLLMetry / Traceloop SDK | OpenLLMetry Python and TypeScript repositories are Apache-2.0 and export standard OTel ([repositories](https://github.com/orgs/traceloop/repositories)). | Excellent automatic provider/framework instrumentation; traces can go to the existing backend rather than Traceloop ([introduction](https://www.traceloop.com/docs/openllmetry/introduction)). | The SDK is instrumentation, not a self-hosted review, dataset, calibration, or drift system. | None by itself. | **Use only if automatic instrumentation saves code.** It logs prompts and completions by default, so content tracing must be disabled for this pipeline ([privacy setting](https://www.traceloop.com/docs/openllmetry/privacy/traces)). |
| OpenLIT | Apache-2.0, self-hostable, and OTel-native ([repository](https://github.com/openlit/openlit)). | Native traces, metrics, logs, model cost, prompts, evals, and exports. | Provides evaluations, prompt management, feedback-oriented workflows, and CI gates. | Still needs custom bounded-classifier calibration logic. | **Watch, do not adopt now.** Its all-in-one ClickHouse-backed platform overlaps the complete existing LGTM, Promptfoo, and feedback stack ([telemetry architecture](https://github.com/openlit/openlit/blob/main/docs/latest/openlit/observability/telemetry/overview.mdx)). |

## Why not make one new platform own everything?

The data has different trust and retention properties:

- operational spans must be cheap, bounded, and safe to aggregate;
- exact transcripts and corrected text are private evidence;
- human-reviewed labels are the source of truth;
- evaluation corpora need stable semantic-family splits and locked holdouts; and
- training datasets eventually need a separate approval and versioning lifecycle.

Copying all of these into a trace product would create a second feedback database and increase the
blast radius of a trace export. Conversely, storing only anonymous counts prevents diagnosis. The
opaque-ID join preserves both properties: ordinary observability stays safe, while an explicitly
authenticated offline job can reconstruct reviewed examples.

## Incremental rollout

### Phase 1: portable spans, no new service

1. Add a manual OpenInference `DECISION` child span around the System One classifier call.
2. Record requested and resolved model versions, prompt/schema hash, selected labels, threshold,
   bounded probabilities, latency, and outcome.
3. Preserve the current payload-free Prometheus metrics; never use transcript, capture ID,
   probability, or model output as a metric label.
4. Verify in the existing Tempo/Grafana trace view that a worker task can be followed to one
   classifier decision without exposing content.

### Phase 2: reviewed quality batch

1. Export only human-reviewed Oxigraph feedback joined to the private inference record.
2. Compute class prevalence, confidence histograms, prediction drift, per-label errors, log loss,
   Brier score, ECE, reliability bins, threshold curves, and feedback delay.
3. Use Evidently for supported classification and distribution metrics; retain the existing tested
   implementations for Brier/ECE or expose them as custom metrics.
4. Publish only aggregate, minimum-cell-size-safe results to Grafana. Keep row-level reports local
   and ignored by Git.

### Phase 3: Oumi run correlation

1. Wrap each Oumi train/evaluate command in a run span.
2. Export bounded callback metrics through OTLP without prompts or dataset rows.
3. Record the resulting adapter/checkpoint digest on the run span.
4. Run Promptfoo qualification separately and attach only its aggregate holdout scores and report
   digest to a qualification span linked by the Oumi run ID.
5. Promote nothing automatically; the reviewed comparison remains the release gate.

## Adoption triggers

Add **Evidently** when there are enough reviewed live rows to compare time windows without exposing
individuals; until then Promptfoo's authored corpus is more informative than drift statistics.

Add **Langfuse** only when collaborative prompt management and annotation queues are a stronger
need than low operational burden. Add **OpenLIT** only if replacing—not duplicating—the existing
observability platform is deliberately in scope. Use **OpenLLMetry** independently when automatic
instrumentation covers a provider integration that would otherwise require significant manual
span code.

## Final recommendation

The better long-term design is a portable inference-event contract, not a new dashboard first:

1. **OpenInference `DECISION` spans into the existing OpenTelemetry pipeline.**
2. **Oxigraph remains the private feedback and evidence authority.**
3. **Promptfoo remains the offline regression and release gate.**
4. **Evidently becomes the optional periodic classifier drift/calibration report.**
5. **A small `oumi-otel` adapter emits bounded run and training signals; no MLflow or new database.**

This sequence preserves local privacy, minimizes operations, and leaves the signals portable to
any standards-compatible OTLP backend later.
