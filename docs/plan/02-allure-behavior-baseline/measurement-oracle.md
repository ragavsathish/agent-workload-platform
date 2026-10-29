---
type: reference
title: "Oracle for the measurement pipeline"
---

# Oracle for the measurement pipeline

**Status:** combined-report adapter oracle implemented; trace and spec-extractor checks
remain planned. This is the closest AWP analogue to Löyly's
[`harness/oracle.sh`](../../../loyly/harness/oracle.sh). It judges the tools that
produce and combine measurements, before an Allure result is used to judge product
behavior.

## What is measured, and by whom

Playwright is one measurement tool. The current
[report runner](../../../products/voice-agent/tests/allure/run-knowledge-review.mjs)
also adapts Patrol web, pytest JUnit and native pytest Allure, Vitest, Node TAP, Rust
test output, and repository probes. Each adapter emits or contributes to the common
Allure result schema: case identity, status, start/stop, steps, labels, and attachment
references. The [coverage audit](../../../products/voice-agent/tests/allure/coverage-audit.mjs)
then derives journey, validation-layer, C2, and C4 counts from those records.

```text
test tools and probes → adapters → Allure result JSON + attachments
                                    ↓
                             coverage audit
                                    ↓
                  product behavior and API baselines
```

The **measurement oracle** judges the arrows above the product baselines. It asks whether
a known tool result is represented faithfully in Allure and in the derived audit. It
does not ask whether a voice turn, task, or API response is the right product behavior.
This separation matters: a green product comparison is meaningless if a failed test was
converted to passed, a retry erased its failed attempt, or a fixture was counted as a
deployed journey.

## Inputs and goldens

Use committed, synthetic input fixtures for each adapter; never use a private production
trace as the instrument's golden. For each fixture, commit the expected **canonical
Allure projection** and expected audit projection. Canonicalization removes random UUIDs,
wall-clock times, absolute temporary paths, and attachment byte payloads while retaining
the measurement contract:

- source case identity and source framework;
- status, including failed, skipped, and flaky after retry;
- ordered Given/When/Then steps with their statuses and durations where supplied;
- attachment names, media types, and whether referenced files exist;
- epic, feature, validation layer, C4 scope, and review-needed labels;
- passed/failed/skipped denominators and deployed/fixture/contract audit classification;
- command failure and missing-result gates.

Compare the canonical projection byte for byte. Compare refusal exit codes and stable
messages where the instrument's behavior is part of the contract. A changed golden is
an explicit review event with an explanation, not a way to silence a red check. The
raw synthetic fixture and expected projection stay versioned together.

## Minimum fixture matrix

| Source | Cases the oracle must distinguish |
| --- | --- |
| Playwright JSON and native Allure | Passed journey with ordered steps and trace; failed journey; failed first attempt followed by pass and preserved retry evidence; skipped case; missing native steps or trace. |
| Playwright trace network | A request/response body referenced from `0-trace.network`; missing referenced resource; redacted method/path/status/shape projection without copying headers or payloads. |
| Patrol web | Passed voice and workspace cases with their own trace and fixture evidence; one failed case with partial evidence; expected case absent from the run. |
| pytest JUnit and native pytest Allure | Passed, failed, skipped; native step and attachment preservation; a required native Gherkin step missing. |
| Vitest, Node TAP, Rust | One pass and one failure each; TAP summary lines must not become cases; Rust ignored maps to skipped. |
| Repository probes and command gates | Probe result and proof attachment; nonzero command or missing machine-readable result becomes failed rather than disappearing. |
| Coverage derivation | Same fixture across deployed, fixture, and contract labels; counts stay in their respective columns; a skipped or missing case cannot increase coverage; stale C4 names are rejected. |
| Allure-to-spec extraction | A step-bearing result preserves step order and source ID; a no-step or skipped case stays in the inventory; a retry with nested attempt steps is not silently reported as having no steps. |

The existing [report-runner tests](../../../products/voice-agent/tests/allure/run-knowledge-review.test.mjs)
already exercise many individual conversions and failure paths. The oracle adds a
committed end-to-end fixture and golden for the **combined output**, so a refactor to
the runner, taxonomy, audit, or [spec extractor](../../spec/extract_allure.py) cannot
move the measurement unnoticed.

## Execution and verdict

The deterministic `make allure-oracle-check` target runs only synthetic fixtures,
normalizes its output, and compares it to committed goldens. It should require no
deployed stack or credentials. Run it from the normal development check and before the
combined report is published or used as baseline evidence. If a tool is genuinely
unavailable, report `unjudged` with the missing tool named; do not report a pass over
zero cases. Report assertion counts and skipped checks explicitly.

Keep `--candidate` separate from `--check`. The candidate command writes only to stdout; it
cannot update the accepted golden without a reviewed diff explaining whether the
change came from an adapter, the Allure schema, the taxonomy, or a deliberately changed
coverage rule. Changes to expected case counts must show the old and new denominator.

## Acceptance

- Every currently integrated tool has a synthetic source fixture and an expected
  canonical Allure projection or an explicit documented gap.
- The same input produces identical canonical output on repeated runs.
- Injecting a changed status, lost retry, missing attachment, wrong validation layer,
  omitted case, or stale C4 scope makes the oracle red.
- A product behavior baseline cannot run green when the measurement oracle is red or
  unjudged for the tool that supplied its evidence.
- The golden can change only through a recorded, reviewed diff.

The current implementation is
[`measurement-oracle.mjs`](../../../products/voice-agent/tests/allure/measurement-oracle.mjs)
with an [accepted OCI layout](../../../products/voice-agent/tests/allure/measurement-oracle.oci/index.json).
The [harness spec](../../../harness/spec.feature) states the measurement contract as
stable Gherkin scenarios. The image manifest identifies a measurement-oracle artifact
and its digest-addressed golden projection and harness spec. `--check` verifies the OCI
descriptors and blobs, stable scenario IDs, and source-spec equality before comparing
the canonical result. `measurement-oracle-oci.mjs pack` creates a candidate layout in a
new directory for review and does not overwrite the accepted layout.
It covers the adapters used by the combined report and its coverage audit. The Playwright
network extractor and standalone [spec extractor](../../spec/extract_allure.py) are outside
this check until they have their own synthetic fixtures and goldens; their output must not
be treated as oracle-qualified evidence yet.

This is the instrument check. The separate [behavior baseline](plan.md) and
[API shape baseline](api-shape.md) use trusted measurements to check accepted product
expectations; they do not replace the instrument check.
