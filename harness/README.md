# AWP measurement harness

[spec.feature](spec.feature) specifies the Voice Agent combined-report instrument. Its
18 stable `@harness-NNN` scenarios cover source case identity, status conversion,
Playwright attempts and evidence, Patrol and framework adapters, command gates,
coverage classification, C4 refusal, OCI custody, and gate placement. It is outside
`docs/plan/`: these are rules for measuring tests, not product behavior requirements.

The executable half is
[`measurement-oracle.mjs`](../products/voice-agent/tests/allure/measurement-oracle.mjs)
and its focused [adapter](../products/voice-agent/tests/allure/run-knowledge-review.test.mjs)
and [OCI](../products/voice-agent/tests/allure/measurement-oracle-oci.test.mjs)
checks. The oracle creates synthetic measurements in temporary directories, checks the
17-case denominator, repeats the fixture to catch nondeterminism, and compares a
canonical projection with the accepted
[OCI artifact](../products/voice-agent/tests/allure/measurement-oracle.oci/index.json).
The OCI artifact contains both the golden projection and this spec. The reader checks
descriptor sizes and digests, stable scenario IDs, and that the packaged spec equals
this source file before judging measurements.

Run `make allure-oracle-check` from the repository root. `make check`, combined report
generation, and report publication run this gate. A red gate means the result cannot be
used as trusted baseline evidence. The source spec is not executed by a Gherkin runner;
each scenario is implemented by the synthetic oracle, a focused adapter test, or the
report and publication gate. See the
[Allure guide](../products/voice-agent/tests/allure/README.md) for the candidate and
OCI review commands.

The current harness covers the combined Allure report adapters. Playwright trace
network extraction and the standalone Allure-to-spec extractor still need their own
instrument fixtures and goldens. Product behavior and API baselines are a separate
[plan](../docs/plan/02-allure-behavior-baseline/plan.md).
