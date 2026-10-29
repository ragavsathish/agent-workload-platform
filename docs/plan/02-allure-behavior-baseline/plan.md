---
type: plan
title: "Slice 02: Reviewed behavior baseline from Allure"
---

# Slice 02: Reviewed behavior baseline from Allure

**Status:** plan only, 2026-10-28. No baseline has been accepted and no comparison gate
has been implemented.

## Purpose

Create a small, reviewable regression baseline for the Voice Agent's observable behavior.
The latest [Allure-observed spec](../../evidence/allure/index.md) supplies candidate cases and exact
recorded steps. Its results are evidence of what the tests observed, not independent proof
that the product requirements are correct. The [testing guide](../../../products/voice-agent/TESTING.md)
and [Allure coverage audit](../../../products/voice-agent/tests/allure/README.md) define
which validation layer each result can support.

The [measurement oracle](measurement-oracle.md) now checks that Playwright
and the other tools are faithfully represented in the shared Allure result schema and
coverage audit. A behavior baseline can only be trusted for a tool whose measurement
path that oracle has judged. The behavior baseline below checks product regression;
the measurement oracle checks the instrument producing its evidence.

The first baseline should answer: **Did these selected behaviors still occur, through
the same boundary, with the required proof?** It should not compare whole report files,
screenshots, transcript text, or the current Allure pass count.

The companion [API shape plan](api-shape.md) covers method, route, request and response
fields, status, headers, and authorization at the browser and private Gateway boundaries.
It is a separate golden because a journey can pass despite an unexercised breaking API
change, while a schema snapshot alone cannot prove a user journey.

## Source and custody

Use the completed run recorded in `artifacts/test-reports/latest.json` as the *candidate*
source. For the first review, pin run `2026-10-28T17-47-20-707Z-36590`, commit `2bd2486`
(104 passed, 1 skipped). Read its `allure-results/*-result.json`, the named JSON proof
attachments, and `coverage-audit.json`. The run is ignored local data; preserve its
identity and result filenames in the committed projection, rather than copying private
attachments into Git.

The intended committed artifact is `docs/baselines/voice-agent/behavior-v1.json`, with
a companion README that explains each accepted rule and its source. An extraction command
may produce a **candidate** in the ignored report directory. A person reviews its diff
and promotes it to the committed baseline. A later run never rewrites the accepted file
as a side effect of checking it.

## Initial behavior set

| ID | Observable rule to keep | Required evidence in the pinned run |
| --- | --- | --- |
| `VOICE-TURN-01` | A deployed voice turn yields a visible transcript and response, playable audio, a retained replay, a fresh turn metric increment, and a trace for that turn. | Passed `Voice conversation / Talk with Pi` **journey** with `voice-session-evidence` and browser proof. Use the telemetry-bearing case; the second voice case without trace steps cannot substitute for it. |
| `DURABLE-01` | A Pi-session scratch request produces an owner-visible native task ID, the same task in Flutter, progress narration, completed state, and a downloaded ZIP containing the uniquely requested file. | Passed `Durable work / Continue durable work` **journey** with `durable-task-evidence` and browser proof. A C2 mock case cannot substitute. |
| `INGRESS-01` | A different tailnet identity is denied at both protected routes while the configured owner can still query the graph. | Passed `Gateway access / Access the protected gateway` **deployed integration** with `tailnet-owner-statuses`: other identity `403` on metrics and graph, owner `200` on graph. |
| `KNOWLEDGE-01` | An owner correction to a test-owned journal entry persists after a fresh browser load. | Passed `Knowledge and review / Correct and review journal knowledge` **deployed integration** with `deployed-knowledge-review` and browser proof. Fixture-backed review cases remain supporting evidence. |
| `HEALTH-01` | The authenticated C4 dashboard renders its modeled panels with live C2 activity and no low-contrast nodes. | Passed `Operations / Inspect system health` **journey** with `grafana-color-evidence` and browser proof. Diagram count is derived from the current model, not frozen to this run's count. |

The [extracted feature files](../../evidence/allure/index.md) provide the step wording and the
[case inventory](../../evidence/allure/cases.md) provides result identities. The skipped official
Grafana trace MCP App browser journey is **not** part of v1. Add it only after it runs
and produces direct proof. Likewise, fixture-only failure cases can become separate
contract baselines, but must never satisfy one of the deployed rules above.

## Projection contract

For each rule, store a stable rule ID; expected validation layer and suite; source run,
commit, result filename, and proof attachment names; the selected proof fields; and
comparison predicates. Keep the result UUID as provenance, not as an identity to match
in future runs. For v1, resolve a future result by the recorded `fullName`, suite, and
validation layer together; reject duplicate matches. A later explicit
`behaviorBaselineId` Allure label could make renames easier to manage, but the pinned
run has no such label, so it is not a v1 prerequisite.

Predicates should express behavior rather than incidental bytes:

- **Presence and relationship:** transcript and response observed; replay exists;
  task ID in proof matches the owner-visible Flutter task; downloaded ZIP entry matches
  the run's unique request marker.
- **State and protocol:** terminal task state is `completed`; narration request succeeds
  with audio content and nonempty bytes; other identity receives `403`; owner receives
  `200`; correction persists after reload.
- **Freshness:** completed-turn metric after the run is greater than before it, and a
  trace ID belongs to that turn. Require the result's own evidence, not a stale global
  counter or a trace found by an unrelated probe.
- **Derived visual checks:** all modeled C4 panels are present, the C2 activity query
  returns a numeric value and maps to the displayed threshold color, and the
  low-contrast list is empty. Recompute the expected panel set from
  the authoritative [diagram sources](../../../products/voice-agent/docs/architecture/README.md).

Do not freeze task/session/trace IDs, timestamps, random markers, audio byte counts,
absolute metric totals, text generated by Pi, screenshot pixels, or execution duration.
Those values may be retained as private evidence in a run, but only the named predicates
belong in the golden. Do not copy raw transcript or credential-bearing attachments into
the committed file.

## Comparison and verdict

Add a read-only comparer, for example `make behavior-baseline-check REPORT=<run-root>`.
It loads the accepted baseline and one completed Allure run. It checks each selected
result's status, validation layer, stable selector, required attachment, parseability,
and predicates. It reports `pass`, `fail`, or `unjudged` per rule with the source result
and a short reason. A missing, skipped, failed, ambiguous, or wrong-layer result is
`unjudged` or `fail`, never `pass`. The command exits nonzero unless every required rule
passes; its report includes both numerator and denominator so a disappearing case cannot
quietly improve the score.

The comparer must read the completed run specified by the caller. It must not silently
fall back to `latest.json`, whose pointer can move while a check is running. Allure report
generation currently writes the run manifest and coverage audit before updating
`latest.json` in [the runner](../../../products/voice-agent/tests/allure/run-knowledge-review.mjs);
the baseline check should run only after that publication point. Report both baseline
and candidate run IDs and commits. A mismatch between the run's recorded commit and the
tested checkout should be surfaced, not normalized away.

## Delivery steps

1. **Judge the instrument.** Implement the [measurement oracle](measurement-oracle.md)
   with synthetic fixtures and committed canonical Allure goldens for the tool adapters
   and coverage audit. Establish a reliable call site before treating report results as
   baseline evidence.
2. **Select and review.** Inspect the five pinned result JSONs and proof attachments;
   confirm the test assertions actually establish each proposed predicate. Narrow any
   rule whose proof is weaker than its wording. Record the selected result filenames.
3. **Pin case identity.** Record each selected result's `fullName`, suite, and
   `validationLayer` in the candidate. Check that this selector is unique in the pinned
   run. A test rename is an explicit baseline mapping change to review.
4. **Build candidate extraction.** Emit a deterministic, redacted JSON projection from
   the pinned run. Validate schema, missing fields, duplicate selectors, and that every
   source case passed at the declared layer. The deployed knowledge attachment currently
   includes correction text rather than a redacted persistence receipt; add a small
   proof field or compare the local attachment without copying its text into the golden.
   Do not generate expected values from the same future run being judged.
5. **Ratify v1.** Review the projection against the product glossary, C4 diagrams,
   current acceptance slice, and raw Allure evidence; commit the accepted baseline and
   its rationale. This human review is the step that turns observed output into a
   regression expectation.
6. **Compare independently.** Implement the read-only comparer and synthetic fixture
   tests: unchanged behavior passes; wrong layer, missing proof, skipped result,
   contradictory state, stale metric, changed identity, and duplicate selector each
   produce a nonpassing verdict. Dynamic IDs and byte counts alone do not fail.
   Implement the API shape comparison as the separate track in
   [api-shape.md](api-shape.md), with its own reviewed golden and route probes.
7. **Exercise twice.** Run the comparer against the pinned report, then against a fresh
   `make allure-durable` report that includes the deployed durable journey. Record both
   verdicts and inspect any drift. The routine `make allure-voice-agent` omits that
   opt-in journey and therefore cannot judge all five rules.
8. **Integrate the gate.** After the two-run review, expose the check as an explicit Make
   target. Add it to a normal quality gate only when the required deployed journeys are
   part of that gate's run; otherwise it must remain an explicit check with an honest
   `unjudged` outcome.

## Acceptance for this slice

- The accepted baseline is small, redacted, versioned, and linked to a reviewed Allure run.
- Every baseline rule names its test layer, required proof, and comparison predicate.
- Replaying the pinned evidence passes; removing or changing any required outcome fails.
- A fixture or component result cannot satisfy a deployed rule.
- A missing or skipped selected case cannot disappear from the denominator.
- Updating the golden requires an explicit reviewed diff and reason; a normal comparison
  cannot record or overwrite it.

## Known limits

This oracle detects drift relative to an accepted observation. It does not establish
that the accepted behavior was the right product requirement. The current Allure steps
were written by the same project that implements the product, so the baseline needs the
explicit review above. Löyly's [harness oracle](../../../loyly/harness/oracle.sh)
illustrates the byte-for-byte principle, but its golden judges harness tools rather than
application behavior; AWP's behavior projection should compare semantic predicates and
preserve the same rule that a changed golden is an event to explain.
