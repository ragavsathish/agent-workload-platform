# Bounded autoresearch protocol

Use this protocol for systematic prompt/policy experiments and, only after an explicit training request plus readiness approval, Oumi training experiments. Optimize learning per unit of time while preserving privacy, safety gates, reproducibility, and the locked holdout.

Autoresearch automates an already-authorized phase. It does not authorize training, deployment, Hub upload, model promotion, new paid compute, dependency installation, infrastructure changes, or expansion of editable scope.

## Freeze the experiment contract

Record before the first candidate:

```yaml
objective: <one primary metric and direction>
baseline: <immutable prompt/config, code, dataset, evaluator, and result digests>
mutable_scope:
  - <exact files or configuration fields>
immutable_scope:
  - evaluator
  - development/challenge dataset version
  - metric definitions
  - safety gates
  - locked holdout
safety_gates: <metrics and predeclared limits>
operational_limits: <latency, memory, duration, and cost limits>
budget:
  max_experiments: <bounded integer>
  max_wall_time: <duration>
  max_consecutive_non_improvements: <bounded integer>
repetitions: <fixed count or escalation rule>
stop_conditions: <success, plateau, resource, and failure conditions>
```

Use development and challenge data inside the loop. Never expose, query, or score the locked holdout while generating hypotheses. Do not change the evaluator, labels, metric extraction, or gates after seeing candidate results; a necessary change starts a new research session and baseline.

Run in an isolated worktree or experiment branch. Preserve pre-existing changes. Never use `git reset --hard`, `git clean`, or broad checkout/restore operations. Revert or replace only experiment-owned files after resolving their exact paths.

## Candidate loop

For each experiment:

1. Select one hypothesis from the queue and identify the expected affected error slice.
2. Change the smallest attributable prompt, policy, model, dataset-mixture, or training-configuration surface permitted by the contract.
3. Run deterministic validation and the cheapest representative smoke test.
4. Run the fixed development/challenge evaluator within the declared budget.
5. Repeat inference or training according to the variance policy; compare paired examples where possible.
6. Reject on any contract, privacy, safety, or operational gate failure.
7. Keep as the development incumbent only when the primary improvement exceeds the declared minimum meaningful delta and no gate regresses.
8. Append the attempt as an immutable entry in the append-only ledger whether it improved, regressed, crashed, timed out, or was invalid.
9. Continue until a declared stop condition is reached; do not ask to continue after every attempt, and do not exceed the authorized budget.

Prefer a parameter-effect map over blind hill climbing. Explore competing hypotheses independently, combine winners only after their individual effects are understood, and include simplification attempts. After several non-improvements, change hypothesis family rather than making increasingly specific changes against the same examples.

## Ledger

Store detailed private ledgers in the ignored experiment root and only aggregate-safe summaries in Git or DVC manifests. Record:

- experiment and parent identifiers;
- hypothesis and affected error slice;
- exact mutable diff or configuration digest;
- code, model, prompt/schema, dataset/split, and evaluator digests;
- seed, repetitions, compute tier, duration, and resource use;
- primary, safety, calibration/robustness, and operational metrics;
- uncertainty or observed variance;
- outcome: `baseline`, `keep`, `discard`, `invalid`, `crash`, `timeout`, or `stopped`;
- decision reason; and
- artifact/report digests where applicable.

Never write transcripts, journal text, corrected text, evidence, identities, secrets, private paths, or row-level model output into an aggregate ledger or telemetry.

## Prompt and policy mode

Allowed candidates may include prompt wording, criteria, few-shot examples, threshold, deterministic filters, grounding rules, schema-preserving output guidance, or a pinned local model choice when the contract permits it.

Use the classifier Promptfoo development configuration for SystemOne candidates. Use the journal extraction, repeated-run bias/variance, and paraphrase-family harnesses for journal candidates. A single scalar is insufficient: use one primary objective plus all predeclared safety gates.

False durable classifier candidates and false journal memories are higher-cost failures than abstention unless the approved experiment contract states another reviewed policy. Do not invent or retune error weights after examining results.

## Oumi mode

Enter only after prompt, criteria, examples, deterministic rules, threshold/model selection, and annotation improvements have plateaued on persistent reviewed error slices, and the user explicitly requests training.

Keep the approved model family, task contract, dataset/split version, evaluator, privacy controls, and deployment format immutable unless the experiment contract explicitly makes one of them the research variable. Candidate variables may include one bounded family at a time, such as:

- data mixture or sampling policy using only approved training rows;
- LoRA target modules, rank, or scaling;
- learning rate, schedule, warmup, batch/accumulation, or regularization;
- epoch/step budget and early-stopping policy;
- context length where truncation analysis supports it; or
- an explicitly reviewed loss weight for a custom trainer.

Use progressive budgets:

1. configuration/schema validation;
2. two-step disposable smoke test;
3. short development run that is comparable across candidates;
4. repeated finalist runs using predeclared seeds; and
5. one full-budget finalist only when the preceding evidence justifies it.

Do not select a candidate from training loss alone. Compare development product metrics through the real inference boundary. For Clef, generic Oumi `TRL_SFT` remains invalid unless Oumi invokes the reviewed Clef-specific joint-head trainer. For journal SFT, validate structured-output behavior, grounding, false-memory precision, miss recall, type/text quality, paraphrase robustness, latency, and reload parity.

Record every checkpoint by immutable digest, but register or alias only qualified finalists. Autoresearch never moves MLflow aliases, deploys, merges adapters, quantizes, or uploads to the Hub without a separate explicit decision.

## Final qualification

When the loop stops, produce the complete ledger, baseline-to-incumbent comparison, parameter-effect findings, rejected hypotheses, resource spend, and remaining uncertainty. Freeze the best development candidate before any holdout run.

Run the locked holdout once only when qualification is explicitly requested. A holdout failure ends qualification; it does not send the case back into the same experiment loop. If the holdout is opened for diagnosis, retire that holdout version before future optimization.
