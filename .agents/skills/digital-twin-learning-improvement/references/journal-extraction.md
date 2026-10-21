# Cognitive journal prompt, annotation, and evaluation contract

Use this reference only for the lightweight cognitive-journal branch. Journal entries are private, grounded `schema:CreativeWork` records; they are not accepted profile facts or classifier labels.

## Production contract

Preserve the checked TypeBox response shape and supported types: `thought`, `idea`, `question`, `decision`, `goal`, `learning`, and `unclassified`. Every entry must have concise standalone text, bounded retrieval topics, and an exact contiguous evidence quote. The runtime must reject invalid JSON/schema, non-verbatim evidence, unsupported paraphrases, low-value fragments, routine commands, system noise, attributed speech, duplicates, and type claims that lack required evidence.

The deterministic prefilter, model prompt/few-shot examples, structured schema, and post-model grounding checks form one extraction policy. Version and evaluate them together. A stricter prefilter can improve precision while creating misses; a permissive prompt can improve recall while increasing false durable captures.

## Build reviewed annotations

Export owner feedback from the private journal-feedback graph and join it to the original capture only inside the private annotation workflow. Interpret feedback as follows:

| Feedback | Reviewed target |
| --- | --- |
| `keep` | Entry is useful; confirm type and text during dataset adjudication. |
| `delete` | False capture or no durable value. |
| `edit` | Capture was useful but text needs the owner correction. |
| `wrong_type` | Capture was useful but the owner-supplied type is authoritative after review. |
| miss | Add the owner-supplied expected entry and type after review. |

An absence of feedback is not approval. Do not use the model's original type, text, or topics as gold without owner review. Retain opaque provenance sufficient to audit the decision, but redact identities and secrets before an example enters an evaluation dataset.

Each private annotation should record an opaque case ID, redacted transcript, expected entries or explicit empty result, exact supporting quote for each expected entry, expected type, reviewed canonical text, optional topics, semantic-family ID, source kind, error slice, annotation status, criteria/prompt version, and split. Keep correction history rather than overwriting the original observation.

## Split without leakage

Use four semantic-family-disjoint partitions:

- **development:** prompt, few-shot, prefilter, and grounding iteration;
- **locked holdout:** promotion decisions only;
- **challenge:** commands, system noise, quotations/attributed speech, consumption without learning, biography, implicit versus explicit cues, mixed/noisy turns, negation, correction, ambiguity, multiple entries, and paraphrase families; and
- **production shadow:** sampled, redacted, owner-reviewed feedback and misses for drift monitoring and a future dataset version.

Cluster paraphrases and near-duplicates before splitting. Keep random production samples alongside actively selected deletes, edits, wrong types, misses, repeated-run disagreements, and underrepresented journal types. Otherwise the annotated corpus will exaggerate failure prevalence and give misleading aggregate metrics.

Once a locked-holdout example is opened for diagnosis, retire that holdout version and build a replacement from independently reviewed semantic families.

## Improve one failure mode at a time

Classify reviewed failures before changing behavior:

- false capture / low durable value;
- missed durable entry;
- wrong type;
- unsupported or distorted text;
- non-verbatim evidence;
- poor or invented topics;
- duplicate or over-segmented entry;
- under-segmented mixed turn;
- schema/runtime failure;
- repeated-run instability;
- paraphrase sensitivity; or
- latency/resource regression.

Prefer deterministic code for rules that are provable from input or schema, such as exact evidence containment, duplicate suppression, schema bounds, and clearly enumerated transport/system noise. Use the prompt, criteria, or few-shot examples for semantic distinctions. Avoid growing regex filters from isolated phrases when a broader reviewed family shows that the boundary is semantic.

Change one attributable hypothesis per experiment. Record prompt/example, prefilter, grounding, schema, model, code, dataset/split, and evaluator digests. Run deterministic unit/contract tests before model-backed evaluation.

## Evaluate and promote

Use the existing journal evaluation scripts as separate views:

- `journal-extraction.eval.mjs`: basic positive/negative extraction and type behavior;
- `journal-bias-variance.eval.mjs`: repeated-run systematic error and instability; and
- `journal-paraphrase-robustness.eval.mjs`: behavior across semantic-family variants.

Report at minimum:

- valid structured response rate and runtime errors;
- entry-level precision, recall, and F1 using reviewed matching rules;
- capture-level empty/non-empty precision and recall;
- per-type precision, recall, F1, and confusion matrix;
- false durable capture rate, missed-entry rate, wrong-type rate, and hallucinated/unsupported rate;
- exact evidence-quote validity;
- text edit rate and normalized edit distance for reviewed corrections;
- duplicate, over-segmentation, and under-segmentation rates;
- topic acceptance/edit rate when topics are evaluated;
- performance by fixed error slice and source kind;
- repeated-run agreement, systematic-error count, variance, and declared weighted error cost;
- paraphrase-family agreement and sensitive-family count; and
- median/p95 latency plus model/schema failure rates.

The current small hard-coded suites are regression evidence, not sufficient estimates of real production quality. Preserve their baseline, then add owner-reviewed examples through versioned private manifests. Do not tune on every annotated example; protect the locked holdout.

Declare the primary objective and safety gates before examining candidate holdout results. A journal prompt/configuration may be promoted only when the objective improves without violating false-capture, grounding, schema, privacy, robustness, or latency gates. Machine judges may assist text-similarity review but cannot replace owner labels. Preserve the prior configuration as the rollback target.

## Observability and artifacts

OTel receives only bounded aggregate signals: extractor/prompt/schema/model version, filtered/model-run outcome, sentence and entry counts, rejected count, latency, schema/error outcome, and fixed low-cardinality reason/type fields. Never export transcript text, journal text, topics, evidence, corrections, identities, capture/entry IDs, private paths, or row-level probabilities as telemetry attributes.

DVC may version approved private annotation/split manifests and aggregate evaluation evidence in the dedicated private artifact workflow. Git stores only DVC pointers and non-sensitive aggregate summaries. MLflow is optional for comparing prompt/configuration experiments; it is not the journal authority and no model registry is needed for prompt-only work.

Do not start journal SFT merely because annotations have accumulated. If prompt, examples, filters, grounding, and model selection plateau on persistent reviewed slices, use the separate Oumi workflow only after an explicit fine-tuning request and a frozen generative-SFT baseline.
