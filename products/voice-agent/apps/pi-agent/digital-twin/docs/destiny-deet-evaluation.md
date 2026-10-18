# DESTINY DEET evaluation for cognitive-journal extraction

Evaluated on 2026-10-18 from
[`destiny-evidence/data-extraction-evaluation-toolkit`](https://github.com/destiny-evidence/data-extraction-evaluation-toolkit),
release `0.5.0`, commit `af7f441f47ca63e7e1223c8955782a6e2c0dadad`.

## Decision

Do not replace Promptfoo or the current journal evaluators with DEET, and do not
embed DEET in the production extraction path. Adopt two DEET patterns in the
private offline evaluation workflow:

1. emit a row-level, human-versus-extractor comparison artefact; and
2. separate source/input failures from extraction failures when diagnosing a
   miss.

Re-evaluate DEET as a direct dependency only after it provides structured
list/dictionary matching suitable for journal entries, or after a small adapter
proves that using the package is cheaper to maintain than implementing those
patterns in the existing JavaScript harness.

## Verification

The repository was cloned into an isolated temporary directory rather than
vendored into this repository. The package identifies itself as beta, requires
Python 3.12 or 3.13, and is Apache-2.0 licensed.

The complete unit suite was run from the pinned lockfile:

```text
AZURE_API_KEY=DUMMY_SECRET AZURE_API_BASE=https://dummy.secret \
  uv run --frozen pytest tests/unit -q

579 passed, 1 skipped, 1 warning
```

A first clean-checkout run without those dummy settings produced one failure
and six setup errors because the default Azure extractor dereferences an absent
API key. DEET's CI supplies the same dummy settings. This is a setup sharp edge,
not evidence of evaluator calculation failures.

No integration test requiring a real model provider was run. No private
transcript or journal data was supplied to DEET.

## What DEET provides

DEET is a Python framework for document-oriented extraction experiments. It
can import human gold annotations, run Azure OpenAI or Ollama extraction, and
write reproducibility artefacts including:

- snapshots of prompts and model configuration;
- structured LLM annotations;
- aggregate `metrics.csv` and `metrics.json` reports;
- a row-level `goldstandard_llm_comparison.csv`;
- token, cost, and stage-duration metadata; and
- development, validation, and final-test split state.

Its built-in metrics are:

| Output type | Built-in metrics |
| --- | --- |
| Boolean | accuracy, precision, recall, F1, positive-label count |
| String | exact accuracy and thresholded normalized Levenshtein match rate |
| Integer/float | exact accuracy, MAE, and MAPE |
| List/dictionary | none |

For string and numeric values, DEET also reports whether the human gold value
was present in the context the model received. It labels mismatches as an exact
match, near match, missing prediction, extraction error with a bad source, or
extraction error with a good source. It additionally compares human and model
supporting text with the source context.

## Fit with this stack

| Concern | Existing owner | DEET fit |
| --- | --- | --- |
| Prompt regression and release gate | Promptfoo plus journal scripts | Keep existing owner; DEET does not replace Promptfoo assertions or our production-boundary provider. |
| Journal entry matching | Journal evaluation scripts | Poor direct fit: one capture contains a list of structured entries, for which DEET has no built-in metric. |
| Exact evidence validation | Production TypeBox and grounding checks | Keep the deterministic production check; DEET's fuzzy evidence score is useful only as a diagnostic. |
| Gold annotation | Owner-reviewed feedback and misses in Oxigraph | Conceptually aligned, but DEET's flat CSV assumes document attributes and does not model keep/delete/edit/wrong-type history. |
| Split hygiene | DVC manifests with semantic-family-disjoint development, challenge, and locked holdout | DEET's dev/validation/test lifecycle is useful inspiration, but its random document assignment does not guarantee semantic-family separation. |
| Bias and variance | Repeated-run and paraphrase harnesses | DEET does not supply these product-specific views. |
| Experiment provenance | Git/DVC manifests and optional MLflow comparison | DEET's prompt/config snapshots and run metadata are worth copying into our result bundle. |
| Production observability | Bounded OpenTelemetry aggregates | Keep separate. DEET artefacts can contain full documents, model output, reasoning, and row identifiers and must never be exported to OTel. |
| Knowledge authority | Oxigraph | No overlap. DEET evaluates extraction; it is not a knowledge store or approval authority. |

## Patterns to adopt

### Row-level comparison artefact

Add a private evaluation-only JSONL or CSV artefact with one row per expected or
predicted journal entry. It should include opaque case and semantic-family IDs,
split, source kind, expected and predicted types, reviewed canonical and
predicted text, exact evidence validity, entry match status, error slice, and
extractor/configuration digest.

Transcript, evidence, correction text, and predicted journal text remain in the
private DVC-controlled artefact. Only aggregate metrics may leave that boundary.

### Failure ownership

Use DEET's source-fidelity distinction, adapted to the journal pipeline:

| Status | Meaning |
| --- | --- |
| `exact_match` | Reviewed expected entry and prediction match under frozen rules. |
| `near_text_match` | Type and evidence match; normalized text differs within the declared threshold. Diagnostic only. |
| `missing_prediction_good_input` | The reviewed evidence was present in the exact eligible transcript sent to the model. This points to prompt/model behavior or post-processing. |
| `missing_prediction_bad_input` | Prefiltering or transcript preparation removed the reviewed evidence. This points to input-policy behavior. |
| `unsupported_prediction` | Predicted evidence is not an exact contiguous quote from the original transcript. |
| `wrong_type` | Entry is matched but its journal type differs from the reviewed type. |
| `false_capture` | No reviewed expected entry matches a prediction. |

This attribution is more actionable than one aggregate F1 score because it says
which boundary should change.

## Implemented bounded POC

The POC extends the journal evaluator rather than invoking DEET end-to-end:

1. freeze a small owner-reviewed development manifest and matching rules;
2. retain both the original transcript and the exact eligible transcript seen
   by the model inside the private result bundle;
3. emit the row-level comparison and failure-ownership statuses above;
4. calculate existing entry, capture, type, grounding, edit, duplicate,
   segmentation, repeated-run, and paraphrase metrics from that comparison;
5. store the private bundle with DVC and publish only safe aggregates; and
6. compare the same frozen cases through Promptfoo as the release-gate view.

The implementation lives in `eval/journal-annotation-export.mjs`,
`eval/journal-annotation-finalize.mjs`, and `eval/journal-reviewed-eval.mjs`.
It takes the useful scientific-evaluation structure from DESTINY without
introducing a second extraction runtime, a Python bridge, duplicate model calls,
or a second source of promotion truth.

## Rejection criteria for direct adoption

Do not add `destiny-deet` to the workspace dependency graph for the initial POC
because:

- the journal result is a set/list of structured records and DEET 0.5.0 has no
  default list or dictionary metrics;
- the project workflow is centered on papers, bibliographic metadata, and
  attribute prompts rather than conversational captures and feedback events;
- its development/validation/test splitting is not sufficient for our
  semantic-family leakage policy;
- using its extraction runner would duplicate the checked production boundary;
  and
- its full run artefacts are intentionally content-rich and conflict with the
  bounded OTel boundary if handled carelessly.

These are integration mismatches, not a criticism of DEET's intended research
use case. Its evaluator and reporting design are strong references for our
offline workflow.
