# Digital-twin classifier evaluation framework

## Decision

Use [Promptfoo](https://github.com/promptfoo/promptfoo) as the evaluation runner and its named and
derived metrics for multiclass scoring. Compare the production local Von boundary with pinned
TypeSafe Jev and Cloudflare's local open-weight Clef-flash decision model over exactly the same gold
claims. Use LM Studio Atla Selene 1 Mini 8B as a secondary semantic judge, never as a classifier row or a
replacement for the human-reviewed gold labels.

Promptfoo is the closest fit for this repository because the classifier is already TypeScript, calls a local Von HTTP service, and produces deterministic structured JSON. Promptfoo is MIT-licensed, runs evaluations locally, supports custom TypeScript providers, accepts checked-in JSON datasets, and exports machine-readable and human-readable CI artifacts. Its official documentation also includes a deterministic classification recipe based on named true-positive, false-positive, false-negative, and true-negative counters with derived precision, recall, and F1 metrics.

The repository supplies only the Von adapter and deterministic assertion functions. Promptfoo owns
provider orchestration, concurrency, caching, test discovery, aggregate precision/recall/F1,
result storage, the local viewer, and CI output.

Primary sources:

- [Promptfoo repository and licence](https://github.com/promptfoo/promptfoo)
- [Custom JavaScript and TypeScript providers](https://www.promptfoo.dev/docs/providers/custom-api/)
- [HTTP provider](https://www.promptfoo.dev/docs/providers/http/)
- [Configuration and supported dataset formats](https://www.promptfoo.dev/docs/configuration/guide/)
- [Deterministic metrics and F-score recipe](https://www.promptfoo.dev/docs/configuration/expected-outputs/deterministic/#f-score)
- [JavaScript assertions and named scores](https://www.promptfoo.dev/docs/configuration/expected-outputs/javascript/)
- [JSON, HTML, and JUnit output formats](https://www.promptfoo.dev/docs/configuration/outputs/)
- [CI/CD quality gates](https://www.promptfoo.dev/docs/integrations/ci-cd/)
- [Strictly local/offline configuration](https://www.promptfoo.dev/docs/faq/#how-can-i-use-promptfoo-in-a-completely-offline-environment)
- [Cloudflare Clef model card and SystemOne API](https://huggingface.co/Cloudflare/clef)

## Evaluation target

The current `classifyTranscript` boundary is a black-box classifier with:

- input: one owner transcript string;
- dependency: `POST /v1/systemone` on the local Von endpoint;
- primary label: `conversation_topic`, `skill_evidence`, `profile_update`, or `none`;
- conditional profile label: `job_title`, `home_location`, `credential`, `employment`, or `none`;
- probability maps and selected-label confidence;
- a derived `review` decision based on the configured threshold.

The Von row calls the production `classifyTranscript` function rather than duplicating its HTTP
payload. Jev uses Promptfoo's native TypeSafe provider with the same criteria. Clef-flash uses the
same Jev/SystemOne request and response contract against a local endpoint. It returns a probability
for every allowed option instead of generating free-form text. Selene receives the transcript,
criteria, and classifier prediction after inference and returns a structured semantic judgment from
LM Studio. Its score is diagnostic and non-gating; exact gold accuracy remains deterministic.

## Why Promptfoo fits

| Requirement | Promptfoo support | Repository approach |
| --- | --- | --- |
| TypeScript integration | Custom providers can be written in TypeScript; the Node API is typed. | Provider imports and calls `classifyTranscript`. |
| Local Von endpoint | Custom JS/TS and generic HTTP providers can call arbitrary services. | Default to `http://127.0.0.1:8000`, overridable through an environment variable. |
| Checked-in gold set | Test files may be YAML, JSON, JSONL, CSV, JavaScript, or TypeScript. | Commit 200 authored cases as JSON. |
| Deterministic scoring | JavaScript assertions can return booleans, numeric scores, or named scores. | Score exact labels, contract invariants, review behaviour, and probability validity. |
| Aggregate metrics | Named and derived metrics support true/false-positive counters, precision, recall, and F1. | Calculate per-class metrics, coverage, safe acceptance, false durable candidates, and Brier score in Promptfoo. |
| CI | The CLI supports failure-on-error and JSON, HTML, and JUnit output. | Upload all three artifacts and fail on explicit safety/quality gates. |
| Local review | The CLI and local viewer retain inputs, outputs, scores, and failures. | Keep raw personal transcripts out of the corpus and reports. |
| Offline/privacy | Hosted telemetry, update checks, sharing, and remote generation can be disabled. | Set all offline environment switches in the eval script and do not use `--share`. |

Promptfoo applies every derived metric independently to each provider/prompt column, producing a
direct model comparison. A full confusion-matrix visualization and expected calibration diagram
can be added later from Promptfoo's JSON export if the first real baseline shows they are useful.

## Alternatives considered

| Framework | Strengths | Why it is not the first choice here |
| --- | --- | --- |
| [Evalite](https://github.com/mattpocock/evalite) | TypeScript-native, built on Vitest, local UI, custom scorers, CI thresholds, and static HTML export. | It is attractive for this stack, but its v1 documentation is still marked beta. It does not remove the need to implement the multiclass and calibration reducer. Promptfoo has first-class external datasets, provider adapters, output formats, and a documented classifier-metric pattern. Revisit once v1 is stable. |
| [DeepEval](https://github.com/confident-ai/deepeval) | Apache-2.0, local-first, pytest/Vitest-style execution, local JSON/JSONL/CSV datasets, custom metrics, and CI support. | Its centre of gravity and richest metric extension API are Python. Using it here would create a parallel Python evaluation stack for a TypeScript component without supplying the required classifier report out of the box. See its [dataset](https://deepeval.com/docs/evaluation-datasets), [custom metric](https://deepeval.com/docs/metrics-custom), and [local storage](https://deepeval.com/docs/evaluation-local-backend-storage) documentation. |
| [Inspect AI](https://github.com/UKGovernmentBEIS/inspect_ai) | Mature, auditable benchmark engine with local datasets, custom model providers, custom scorers, rich logs, and a viewer. | Excellent for broad model and agent benchmarks, but heavier and Python-based for this bounded four-class regression suite. See [datasets](https://inspect.aisi.org.uk/datasets.html), [models/providers](https://inspect.aisi.org.uk/models.html), and [scoring](https://inspect.aisi.org.uk/scoring.html). |
| [Langfuse](https://github.com/langfuse/langfuse) | Open-source/self-hosted observability, datasets, experiments, custom scores, TypeScript SDK, and CI experiments. | Best as the later production feedback and drift layer. It requires a service and is more platform than is needed to run a checked-in gold corpus. See the [evaluation overview](https://langfuse.com/docs/evaluation/overview) and [datasets](https://langfuse.com/docs/evaluation/experiments/datasets). |
| [Giskard OSS](https://github.com/Giskard-AI/giskard-oss) | Behavioural testing and security scanning for agents, with pytest integration. | Better suited to later multi-turn voice-agent safety and adversarial tests than to probability calibration and a small multiclass classifier. See the [Giskard OSS documentation](https://docs.giskard.ai/oss). |
| [Ragas](https://github.com/vibrantlabsai/ragas) | Local datasets and extensible evaluation metrics. | Primarily shaped around RAG and generative-answer evaluation, so its abstractions do not simplify this ontology classifier. |
| [OpenAI Evals](https://github.com/openai/evals) | MIT-licensed benchmark framework with JSONL data and custom/private evaluations. | Its official setup is Python and OpenAI-oriented; adapting the local Von classifier is less direct than a Promptfoo TypeScript provider. |

## Repository shape

```text
apps/pi-agent/digital-twin/eval/
├── promptfooconfig.mjs
├── von-provider.mjs
├── assert-classification.mjs
└── digital-twin-classifier.gold.json
```

- `von-provider.mjs` calls the exported production `classifyTranscript` function.
- The gold JSON contains 40 reviewable scenarios with five wording variants each.
- `assert-classification.mjs` validates the common bounded output and emits Promptfoo counters.
- The config maps the same typed questions to Von, Jev, and local Clef-flash, then derives comparable
  precision, recall, F1, coverage, safety, and probability metrics.
- `judge-config.mjs` exposes local LM Studio Selene through Promptfoo's native `llm-rubric` grader,
  adding a diagnostic semantic score and review reason to every classifier result while preserving
  caching, retries, token usage, and grader-error metadata.
- `judge-calibration.promptfooconfig.mjs` keeps 20 paraphrase groups wholly within a 32-row
  development split or an 8-row locked holdout. Human verdicts live separately in
  `digital-twin-judge.labels.json`; unreviewed entries remain explicit.
- `summarize-judge-results.clj` excludes Promptfoo `graderError` rows from semantic agreement and
  reports them as `notJudged`.

A case should carry enough metadata for slicing without leaking private session data:

```json
{
  "description": "question about a technology is not skill evidence",
  "vars": {
    "transcript": "How does Kubernetes schedule a pod?",
    "expectedKind": "conversation_topic",
    "expectedProfileField": "none",
    "risk": "false_durable_fact",
    "tags": ["question", "technology", "boundary"]
  }
}
```

Use anonymised or authored utterances in the committed suite. If exact production transcripts are needed for a private acceptance run, load them from an ignored local JSONL file and generate a redacted aggregate report.

## Gold-set design

Start with 200 independently reviewed, atomic owner utterances:

| Expected kind | Initial count | Coverage emphasis |
| --- | ---: | --- |
| `none` | 50 | transient commands, questions, speculation, negation, corrections, quoted claims, and third-party claims |
| `conversation_topic` | 50 | explicit ongoing learning, interests, and subjects being investigated without a capability claim |
| `skill_evidence` | 50 | explicit first-person use, knowledge, and capability claims |
| `profile_update` | 50 | roughly balanced across job title, home location, credential, and employment; include corrections and historical/non-current statements |

At least one third of the corpus should be boundary or adversarial examples. Tag each case by source pattern and risk so the report can show slices such as questions, commands, negation, correction, indirect claim, third-party claim, quoted speech, and ambiguous wording.

The production classifier currently returns one primary label for a whole transcript. Mixed statements such as “I moved to Helsinki and I am learning DDD” should initially live in a separate diagnostic slice rather than silently assigning an arbitrary gold label. They become gating cases only after the product defines precedence or splits transcripts into atomic claims.

## Metrics

The scorer should calculate:

1. **Kind classification**
   - four-by-four confusion matrix;
   - precision, recall, and F1 for each kind;
   - macro and support-weighted F1;
   - overall accuracy.
2. **Profile-field classification**
   - five-by-five confusion matrix;
   - per-field and macro F1, both overall and on expected `profile_update` cases;
   - consistency violations, such as a non-profile kind paired with a non-`none` profile field.
3. **Safety**
   - durable-fact precision, where `skill_evidence` and `profile_update` are durable predictions;
   - false durable-fact rate on `none` and `conversation_topic` cases;
   - auto-accepted error rate for incorrect cases with `review: false`;
   - review capture rate: proportion of incorrect durable predictions sent to review.
4. **Contract quality**
   - valid response rate;
   - all expected probability labels are present;
   - probabilities are finite, within `[0, 1]`, and sum to one within a small tolerance;
   - selected confidence agrees with the selected label's probability;
   - selected label has the maximum reported probability, unless Von documents another rule.
5. **Calibration**
   - multiclass Brier score;
   - expected calibration error using fixed, documented bins;
   - accuracy and volume above and below the configured production review threshold;
   - reliability data in the JSON/Markdown report.

Do not let the LLM judge replace these labels. Expected classes and invariants remain deterministic.
Use Selene only as a non-gating disagreement signal for qualitative review; a Selene opinion cannot turn
an incorrect gold-label prediction into a passing result.

## Initial gates

The first complete run should establish the baseline before final thresholds are locked. The following are sensible safety-oriented starting gates to ratchet from:

- response/contract validity: `100%`;
- durable-fact precision: at least `0.98`;
- false durable-fact rate on negative cases: at most `0.02`;
- `none` recall: at least `0.95`;
- primary-kind macro F1: at least `0.90`;
- profile-field macro F1 on profile cases: at least `0.90`;
- auto-accepted error rate: at most `0.02`;
- no per-class recall regression greater than two percentage points versus the checked-in baseline.

Calibration should be reported in the first iteration, not gated until there are enough cases in each confidence bin. A 200-case suite is useful for regression detection but too small to claim precise real-world calibration.

## CI and privacy

Run with the local Von service available and disable Promptfoo's hosted features:

```sh
make digital-twin-eval ARGS='--no-cache \
  --output digital-twin/eval/results/results.json \
  --output digital-twin/eval/results/report.html \
  --output digital-twin/eval/results/results.junit.xml'
```

The checked-in command uses `PROMPTFOO_SAFE_MODE=true` and `--no-share`; result paths are ignored because they
contain every synthetic transcript and model output. Upload JSON, HTML, and JUnit only to the
private CI artifact store.

Promptfoo caches successful provider responses by default. Use a repository-scoped cache in CI for speed, but include model version, classifier code, review threshold, and prompt/criteria revision in the effective provider identity. Use `--no-cache` for release qualification or when measuring stochastic variation. See the official [caching documentation](https://www.promptfoo.dev/docs/configuration/caching/).

Keep Vitest or the existing Node test runner for deterministic unit and contract tests. Promptfoo should own model-behaviour regression over the gold corpus; it does not replace ordinary tests.

## Implementation sequence

1. Start local Von and Clef-flash SystemOne endpoints, plus LM Studio with Selene 1 Mini 8B as judge;
   configure TypeSafe Jev when its API key is available.
2. Run a no-cache baseline and inspect every disagreement in Promptfoo's local viewer.
3. Human-review the authored gold labels before locking release thresholds.
4. Check in only an aggregate approved baseline summary; never check in raw private transcripts.
5. Enable CI gates after the baseline establishes realistic thresholds.
6. Add production patterns only after redaction and human relabelling; never promote the
   classifier's own answer to a gold label.
