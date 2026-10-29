# The AWP measurement harness, specified independently of product behavior.
#
# This file is the contract for the Voice Agent combined-report instrument:
# the tool adapters, Allure projection, coverage audit, refusal paths, and the
# OCI artifact that holds the accepted golden. It is outside docs/plan so its
# scenarios never enter a product behavior baseline or coverage denominator.
#
# The examples use synthetic input and no deployed service or private data.
# harness/spec.feature travels inside the OCI oracle artifact. The oracle first
# verifies that its packaged copy equals this source, then judges the instrument
# against the accepted golden. A changed spec requires an explicit artifact diff.
#
# Stable @harness-NNN ids identify contracts. Do not renumber or reuse them.
# The executable checks are measurement-oracle.mjs, measurement-oracle-oci.test.mjs,
# and run-knowledge-review.test.mjs. The spec is not interpreted as Gherkin at runtime.

Feature: The AWP measurement harness records tool observations faithfully

  Rule: Every source case has one stable Allure measurement

    @harness-001
    Scenario: The synthetic combined run preserves its case denominator
      Given inputs from Playwright, Patrol, pytest JUnit, native pytest Allure, Vitest,
        Node TAP, Rust, a repository probe, and a command gate
      When the adapters create the combined result
      Then it contains exactly 17 cases: 8 passed, 6 failed, and 3 skipped
      And each case retains a stable fullName and source framework
      And no summary line is counted as a case

    @harness-002
    Scenario: The same source produces the same canonical projection
      Given the same synthetic inputs and architecture sources
      When the measurement run is repeated
      Then the canonical JSON is byte identical
      And random UUIDs, wall-clock times, temporary paths, and attachment bytes are absent
      And source identities, statuses, labels, ordered steps, and attachment metadata remain

    @harness-003
    Scenario: An unknown test status cannot become a pass
      Given an adapter receives a status other than passed, skipped, pending, or todo
      When it emits an Allure result
      Then the result status is failed

  Rule: Attempts, steps, and evidence retain what the test tool observed

    @harness-004
    Scenario: A Playwright retry retains the failed attempt
      Given a Playwright case fails once with a trace and then passes with JSON proof
      When its JSON result and native Allure records are combined
      Then its case status is passed and it is marked flaky
      And both attempts keep their evidence with attempt numbers and media types
      And each attempt keeps its own measured Given and Then steps in time order

    @harness-005
    Scenario: Reporter housekeeping is not a behavior step
      Given native Playwright Allure steps include Given, Then, and After Hooks
      When the native steps are attached
      Then Given and Then remain with their statuses and durations
      And After Hooks is not reported as an execution step

    @harness-006
    Scenario: A skipped Playwright case remains visible without invented steps
      Given a Playwright case was skipped and has no native steps
      When the combined result is emitted
      Then the case is skipped and has zero steps
      And the absence of steps is not treated as a passing journey

    @harness-007
    Scenario: A non-skipped native case without behavior steps refuses conversion
      Given a non-skipped Playwright or native pytest case without any Given, When,
        Then, And, or But step
      When its native steps are converted
      Then conversion fails and names the case

    @harness-008
    Scenario: Playwright evidence cannot escape its output directory
      Given a Playwright attachment path outside that run's output directory
      When the attachment is copied into Allure results
      Then conversion fails and names the case

    @harness-009
    Scenario: Patrol failure keeps available evidence
      Given the voice Patrol target passed with a trace and HTML report
      And the workspace target failed before its HTML report was written
      When both targets are converted
      Then both cases remain, with passed and failed statuses respectively
      And each case retains the evidence that exists for it

    @harness-010
    Scenario: Framework parsers do not change failure or skip semantics
      Given pytest JUnit pass, failure, and skip records; Vitest pass and failure records;
        Node TAP ok and not ok subtests; and Rust ok, FAILED, and ignored records
      When each is adapted to Allure
      Then failed records stay failed and ignored or skipped records stay skipped
      And TAP totals do not become cases
      And native pytest steps and attachment references remain attached

  Rule: The audit distinguishes evidence from coverage claims

    @harness-011
    Scenario: Missing results and failed commands remain visible
      Given a command expected one machine-readable result and received none
      When the runner records that command
      Then it emits a failed command gate with the error and log attachment
      And a successful repository probe remains a separate passed measurement

    @harness-012
    Scenario: Fixture evidence cannot count as deployed evidence
      Given passed fixture, deployed, and contract cases with C4 labels
      When the coverage audit counts each C2 element and view
      Then each pass increases only its own evidence-mode column
      And skipped and failed cases increase no passed column
      And command gates do not increase journey coverage

    @harness-013
    Scenario: Stale architecture references stop report generation
      Given a result names a C2 container or C4 view absent from current Mermaid sources
      When C4 traceability is validated
      Then validation fails and names the stale reference
      And an unmapped C4 scope also fails

  Rule: The accepted oracle is a reviewable OCI artifact

    @harness-014
    Scenario: The accepted golden is read from an OCI image layout
      Given an image index naming one measurement-oracle-v1 manifest
      And that manifest has the measurement-oracle artifact type, an empty config,
        a golden JSON layer, and a harness spec layer
      When the oracle reads the layout
      Then it verifies every descriptor's size and SHA-256 digest
      And the golden has schema 1 and a nonempty case list

    @harness-015
    Scenario: A changed blob or changed harness spec refuses judgement
      Given a golden or spec blob whose bytes differ from its descriptor
      Or a packaged spec whose bytes differ from harness/spec.feature
      When the oracle reads the layout
      Then it fails before comparing measurements

    @harness-016
    Scenario: Recording a candidate cannot silently replace the accepted golden
      Given an accepted OCI layout already exists
      When a candidate projection is packed
      Then the pack command requires a new output directory
      And writing to the accepted layout fails

    @harness-017
    Scenario: A changed measurement cannot pass against the accepted golden
      Given an accepted canonical projection
      When a case status, case count, attachment presence, or validation layer changes
      Then the oracle reports a mismatch and exits nonzero

    @harness-018
    Scenario: Report generation and publication run the oracle first
      Given the oracle is red
      When the combined report runner or latest-report publisher starts
      Then neither creates or publishes a report
      And make allure-oracle-check also fails
