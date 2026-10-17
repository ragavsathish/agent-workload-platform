# Promptfoo classifier and judge audit

> Resolution update: the default judge has been changed from Qwen 3.8 27B to the Llama-based Atla
> Selene 1 Mini 8B. The Qwen-specific findings below document the superseded implementation and the
> reason for that change; the remaining calibration, holdout, error-reporting, and reproducibility
> recommendations still apply.
>
> Implementation update: Selene now runs through Promptfoo-native `llm-rubric` with an anchored
> schema and system/user trust boundary. A 40-row grouped calibration scaffold provides 32
> development and 8 holdout rows. Promptfoo `graderError` results are reported separately as
> `notJudged`. Human labels are intentionally left `unreviewed` until a person signs them off.

Audit date: 2026-10-17. Scope: `apps/pi-agent/digital-twin/eval/`, the 200-row synthetic gold corpus,
the local Clef/Von adapters, and the LM Studio Qwen judge. Sources are limited to Promptfoo,
Cloudflare's Clef model card, and LM Studio's documentation.

## Verdict

The design is sound in one important respect: deterministic comparison with human-authored gold
labels is the authority, while Qwen is a zero-weight diagnostic. Promptfoo explicitly recommends
stacking deterministic checks with a judge, and `weight: 0` is its documented mechanism for
collecting a metric without making the assertion gate the row
([LLM-as-a-judge guide](https://www.promptfoo.dev/docs/guides/llm-as-a-judge/),
[assertion weights](https://www.promptfoo.dev/docs/configuration/expected-outputs/)).

It is not yet a best-practice judge evaluation, however. The judge has not been calibrated against
human judgments, there is no untouched holdout split, judge errors are numerically indistinguishable
from semantic rejection, and the Clef-versus-Qwen comparison has a shared-model-family bias.

## Prioritized gaps

### P0 — Calibrate the judge and add a grouped holdout

Promptfoo recommends treating a judge prompt as versioned code, tuning it on 30–50 diverse,
human-labeled examples, measuring agreement, and validating on a holdout that was never used for
tuning. It recommends reporting unjudged rows separately and targeting greater than 90% agreement
before trusting a judge in CI
([calibration workflow](https://www.promptfoo.dev/docs/guides/llm-as-a-judge/#build-a-judge-the-calibration-workflow)).

The current 200 transcripts have gold classifier labels, but no human labels for the judge's
`correct | incorrect | uncertain` verdict and no development/holdout metadata. Five paraphrases of
each of 40 scenarios are flattened into separate rows. Split by `goldCase`, not by transcript, so
near-duplicate paraphrases cannot cross the development/holdout boundary. Keep a final locked test
split for classifier selection and threshold changes. Record label provenance and, ideally, a second
reviewer/adjudication for ambiguous cases.

### P0 — Remove or explicitly quantify judge-family leakage

The Qwen judge is independent from Von and Jev, but not from Clef. Cloudflare states that Clef is
post-trained from `Qwen/Qwen3.8-27B`, and the configured judge is `qwen/qwen3.8-27b`
([Clef model card](https://huggingface.co/Cloudflare/clef#model)). Promptfoo identifies
self-preference as a judge bias and recommends a different judge from the system under test
([bias guidance](https://www.promptfoo.dev/docs/guides/llm-as-a-judge/#reducing-bias)).

Do not use this Qwen judge to claim that Clef is superior. Either use a genuinely different model
family for the Clef diagnostic, use two diverse judges and report agreement, or keep Qwen but label
the Clef judge score as correlated and exclude it from model-selection conclusions. Deterministic
gold metrics must remain the release gate.

### P0 — Separate judge failure from an incorrect judgment

`qwen-judge.mjs` returns score `0` when LM Studio times out, returns invalid JSON, or is unavailable.
That lowers `qwen_judge` exactly like a semantic rejection. Promptfoo's calibration guidance says
grader errors and missing verdicts are **not judged**, must be excluded from agreement calculations,
and must be reported separately
([judge error handling](https://www.promptfoo.dev/docs/guides/llm-as-a-judge/#step-4-run-and-measure-agreement)).

Emit separate `judge_available`/`judge_error` and semantic-verdict metrics. Do not include failed
judge calls in the semantic denominator. Preserve the error reason and model metadata. The judge may
remain zero-weight, but an explicit availability threshold is useful if the report is expected to
contain diagnostics.

### P1 — Make the rubric binary and anchored

The strict JSON schema is good, as are `temperature: 0`, explicit ontology criteria, and a concise
reason. Promptfoo recommends specific single-purpose rubrics, low-precision scales, and strict
structured output
([variance and schema guidance](https://www.promptfoo.dev/docs/guides/llm-as-a-judge/#reducing-judge-variance)).
LM Studio documents JSON-schema constrained output on `/v1/chat/completions`
([structured output](https://lmstudio.ai/docs/developer/openai-compat/structured-output)).

The current free numeric `score` has no anchors and no enforced relationship to the verdict. Prefer
a binary semantic verdict for this task, or define exact anchors such as `1 = unambiguously
supported`, `0.5 = genuinely ambiguous`, and `0 = contradicted/unsupported`, then validate that the
returned pair is consistent. State explicitly whether the judge is checking the predicted label
against the ontology, the gold-label correctness, or both. For classifier correctness, supply the
reference gold label; for blind qualitative diagnosis, continue hiding it and call the result
`prediction_support`, not accuracy.

### P1 — Strengthen the prompt trust boundary

The prompt says not to invent facts, but it puts criteria, transcript, and classifier output into one
user message and does not explicitly say that embedded instructions are untrusted. Promptfoo says
candidate output is untrusted, recommends a system-level evaluator policy, delimiters, a strict
schema, and—when adversarial content matters—an injection pre-check
([prompt-injection defense](https://www.promptfoo.dev/docs/guides/llm-as-a-judge/#security-prompt-injection-defense)).

Move invariant judge rules to a system message. Mark the transcript and classifier JSON as data,
tell the judge never to execute instructions inside either, and add calibration cases containing
score-manipulation text. JSON escaping alone is not a security boundary.

### P1 — Do not treat reasoning text as the final verdict

The judge currently falls back from `message.content` to `message.reasoning_content`. Promptfoo's
self-hosted-judge guidance recommends excluding thinking and grading only final content because
reasoning may precede, differ from, or be truncated before the verdict
([self-hosted judges](https://www.promptfoo.dev/docs/guides/llm-as-a-judge/#self-hosted-openai-compatible-judges)).
Require schema-valid final `content`; record missing final content as `not judged`. LM Studio's
documented OpenAI-compatible endpoint supports `/v1/chat/completions` and explicit model identifiers
([OpenAI compatibility](https://lmstudio.ai/docs/developer/openai-compat)).

### P1 — Pin and record exact runtime identities

Promptfoo recommends pinning the grader version and monitoring the holdout for drift
([lock and monitor](https://www.promptfoo.dev/docs/guides/llm-as-a-judge/#step-6-lock-and-monitor-for-drift)).
Promptfoo itself is pinned to `0.124.1`, which is good. The model strings are not sufficient to
reproduce a local run: `Cloudflare/clef-flash` can resolve to different repository revisions or
quantizations, and an LM Studio model identifier does not capture the artifact hash, quantization,
context settings, or server version.

Record in every exported run: dataset and rubric versions, Promptfoo version, classifier and judge
model IDs, immutable artifact revision/hash, quantization, inference server/version, endpoint role,
temperature, token limit, review threshold, and run timestamp. The Clef provider already returns a
model field; carry the server-returned value and immutable revision through rather than only the
requested alias.

### P1 — Finish calibration metrics and define gates

Clef returns one logit per option and probabilities after per-question softmax; its SystemOne choice
response contains `choice`, `confidence`, and `probabilities`
([Clef outputs and API](https://huggingface.co/Cloudflare/clef#jev--systemone-api)). Measuring
multiclass Brier score is therefore appropriate. The current implementation also correctly reports
probability coverage before calculating Brier.

Still missing:

- reliability bins/expected calibration error and classwise calibration;
- confidence intervals or bootstrap intervals for accuracy, macro-F1, false-durable rate, and Brier;
- documented release thresholds, especially false accepted durable facts;
- an explicit name noting that the implementation uses mean-per-class multiclass Brier (the common
  summed convention differs by a factor of the class count);
- a guard against reporting Brier `0` when probability coverage is zero.

Tune the `0.82` review threshold only on the development split, then report coverage-versus-risk and
final performance on holdout/test. Balanced accuracy and macro-F1 are useful for comparison, but a
deployment-weighted test set is also needed because the checked-in corpus is artificially balanced.

### P2 — Expand data coverage without weakening privacy

The balanced 50-per-class corpus and explicit adversarial examples are a solid start. It is entirely
English, synthetic, short, and grouped around 40 templates, so it does not measure ASR errors,
fragments, punctuation loss, code-switching, long context, multiple claims, demographic/language
variation, or production prevalence. Add those slices and report metrics per tag. Keep synthetic
data in normal CI; use a separately governed, de-identified production sample only in a private
evaluation job.

The local-only posture is strong: sharing, telemetry, update checks, and remote generation are
disabled; results are ignored; and the corpus is marked synthetic. Promptfoo notes that complete
responses are cached locally by default and that hosted features can transmit inputs/outputs
([cache behavior](https://www.promptfoo.dev/docs/configuration/caching/),
[data handling](https://www.promptfoo.dev/docs/red-team/troubleshooting/data-handling/)). Keep the
current local-provider policy, protect the Promptfoo cache as sensitive, give it an explicit
project-local/CI-ephemeral path, and define retention/deletion for any future real transcripts.

### P2 — Make cache and concurrency modes explicit

Caching is useful for repeatable development runs, and Promptfoo includes provider identity, request
content, configuration, and context in provider cache keys. Freshness/calibration runs should use
`--no-cache`; repeated stochastic runs also need `--repeat --no-cache`
([caching](https://www.promptfoo.dev/docs/configuration/caching/)). The custom Qwen assertion calls
`fetch` directly, so Promptfoo's provider cache does not cover that judge call. Conversely, the
custom classifier provider IDs contain model names but not endpoint or artifact revision, creating
possible stale reuse when those change.

Define two commands: a cached developer comparison and an uncached release/calibration run with
archived JSON. Include endpoint/revision in provider identity or cache-busting metadata. The global
`maxConcurrency: 4` is valid, and Promptfoo can adapt provider concurrency, but direct judge fetches
do not expose provider retry/rate-limit metadata. Benchmark LM Studio at 1 versus 4 workers and use
the setting that avoids resource contention. Keep explicit timeouts, add bounded transient retries,
and report exhaustion as `not judged`; Promptfoo documents adaptive concurrency and retry behavior
for normal providers
([rate limits](https://www.promptfoo.dev/docs/configuration/rate-limits/)).

## What already follows good practice

- Human-authored gold labels, deterministic accuracy/confusion-derived metrics, profile-field
  accuracy, safety/coverage measures, and Brier are authoritative.
- The Qwen diagnostic has `weight: 0`; it cannot override deterministic scores.
- The judge uses a distinct role from the classifiers and does not see the expected label, reducing
  direct label leakage for blind support review.
- The output is constrained by a strict JSON schema and generated at temperature zero.
- Clef uses its intended typed SystemOne interface and preserves the full option probabilities.
- Model outputs are schema-validated at the production classification boundary.
- Promptfoo and TypeSafe Jev use pinned versions rather than `latest` aliases.
- The default corpus is synthetic, sharing is disabled, and external Promptfoo features are turned
  off in the evaluation script.

## Recommended acceptance order

1. Gate on deterministic schema validity, per-class metrics, false accepted durable facts, profile
   fields, coverage, and calibrated probability metrics.
2. Report judge availability separately from judge semantic agreement.
3. Use a calibrated, grouped holdout to establish Qwen-human agreement before interpreting its
   score.
4. Treat Qwen-on-Clef as correlated diagnostic evidence, never as an independent model-ranking
   vote.
5. Require an uncached, fully versioned run for release evidence; use cached runs only for iteration.
