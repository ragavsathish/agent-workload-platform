# Digital twin learning metrics contract

Use this contract for annotation reports, prompt or policy experiment manifests, inference OTLP instrumentation, Promptfoo qualification, and promotion decisions. Set gates before evaluating a candidate from the approved baseline and product risk; never invent them during result review. Training health and model-registry requirements belong to the training skills.

## Dataset readiness

Record these only in the private approval manifest unless explicitly marked aggregate-safe:

- reviewed, excluded, and pending row counts;
- counts by expected class, feedback outcome, and split;
- semantic-family counts and split-disjointness result;
- normalized duplicate and cross-split overlap counts;
- invalid SystemOne request, question, criteria, or label counts;
- redaction and secret-scan failures;
- state/question token-length distributions and truncation risk;
- class prevalence and imbalance ratios; and
- exporter, validator, ontology, criteria, feedback-snapshot, and split hashes.

Any unreviewed training row, split-family overlap, invalid label, or redaction failure is a readiness failure. Minimum counts must come from a checked-in experiment policy or approval manifest.

Also report these privacy-safe annotation aggregates:

- newly reviewed, corrected, adjudicated, excluded, and still-pending counts;
- inter-annotator agreement where multiple reviewers are used;
- counts and disagreement rates by fixed error slice;
- random-sample versus actively sampled counts;
- duplicate and semantic-family cluster sizes; and
- development, locked-holdout, challenge, and production-shadow counts.

Do not report annotation volume as model quality. High-value coverage means reviewed representation across classes, risk slices, and production patterns while preserving an unseen, semantic-family-disjoint holdout.

## Prompt and policy experiments

Record one immutable experiment entry per candidate:

- prompt, criteria, ontology, scorer, threshold, classifier-code, and dataset/split digests;
- the named error slice and one attributable hypothesis;
- development metrics versus the incumbent configuration;
- contract-test result and provider/production/scorer parity result;
- locked-holdout evaluation count for that dataset version;
- promotion decision and rollback configuration; and
- aggregate latency, failure, and cost/resource changes.

Do not repeatedly query the locked holdout during prompt development. Once its examples are exposed for diagnosis, mark that holdout version retired.

## Promptfoo qualification

Compute against the exact production boundary and immutable locked holdout:

### Classification

- exact assertion-kind accuracy;
- exact profile-field accuracy when applicable;
- per-class precision, recall, and F1;
- macro and weighted F1;
- confusion matrix;
- false durable candidate count/rate;
- safe-acceptance rate and review coverage; and
- performance by risk slice, statement form, and semantic family.

### Probability quality

- probability-vector validity and normalization;
- Brier score overall and by class;
- negative log loss;
- expected calibration error with frozen bins;
- reliability-table/diagram data;
- confidence distribution by correct/incorrect outcome; and
- threshold-versus-coverage, error, and false-durable curves.

### Robustness

- paraphrase-family agreement and variance;
- schema field-order invariance;
- choice-option order invariance;
- criteria wording sensitivity;
- repeated-run determinism; and
- behavior on commands, questions, hypotheticals, negations, quotations, third-party claims, and mixed turns.

### Operational contract

- valid SystemOne response rate;
- timeout, transport, and malformed-response rates;
- median, p95, and p99 latency;
- records/questions per second;
- peak CPU/GPU memory and utilization; and
- model, processor, joint-head, adapter, runtime, classifier-code, and Promptfoo versions/digests.

Judge agreement is diagnostic and reported separately from deterministic gold-label metrics. Grader errors are `not judged`, not semantic failures.

## Production improvement loop

Publish only bounded aggregates:

- decision count by fixed class;
- review, acceptance, rejection, correction, and miss rates;
- confidence histograms using frozen buckets;
- class/prevalence and confidence drift;
- realized precision/recall/calibration after reviewed labels arrive;
- feedback delay;
- inference latency/error distributions; and
- current bounded model/extractor version.

Never use transcript, identity, opaque example/capture/run ID, private path, dataset/checkpoint hash, criteria text, evidence, correction text, or individual probability vectors as metric labels. Hashes may appear on run spans or private manifests. Individual probabilities may appear only in privacy-controlled traces if explicitly approved; prefer private evaluation records.

## Experiment scorecard

Every experiment manifest should declare:

```yaml
primary_objective: <one metric and comparison direction>
safety_gates:
  false_durable_rate: <predeclared policy>
  probability_contract: <predeclared policy>
  calibration: <predeclared policy>
secondary_metrics:
  - macro_f1
  - review_coverage
  - paraphrase_family_agreement
operational_limits:
  p95_latency: <predeclared policy>
  peak_memory: <predeclared policy>
baseline:
  artifact_digest: <approved digest>
  promptfoo_report_digest: <approved digest>
candidate:
  prompt_criteria_config_digest: <immutable digest>
  dataset_split_digest: <immutable digest>
```

The agent may stop unhealthy runs, calculate comparisons, and recommend a candidate. It may not select thresholds after seeing results, repeatedly tune on the locked holdout, promote automatically, or trade a safety regression for a higher aggregate score without an explicit human decision.
