---
type: reference
title: "Test oracles in the Gondolin Patrol harness"
---

# Test oracles in the Gondolin Patrol harness

_Research note: 2026-10-21. Scope: the current manual Compose plus Patrol VM benchmark._

## Meaning

A **test oracle** is the source or rule that lets a test decide whether an
observed result is acceptable. The [ISTQB glossary](https://glossary.istqb.org/en_US/term/test-oracle)
defines it as a source for an expected result; an
[expected result](https://glossary.istqb.org/en_US/term/expected-result)
is observable predicted behavior under specified conditions. Barr et al.'s
[test-oracle survey](https://discovery.ucl.ac.uk/id/eprint/1471263/) calls the
difficulty of distinguishing correct from incorrect behavior for a given input
the *test oracle problem*. Its discussion includes specifications, models,
contracts, metamorphic relations, and human judgment as possible sources of
oracle information.

A **test harness** is the machinery that executes the test. ISTQB describes it
as a collection of drivers and test doubles needed to execute a suite
([test harness](https://glossary.istqb.org/en_US/term/test-harness)). In this
repository the harness includes the VM launcher, Compose bootstrap, fixture
server, Patrol runner, trace collection, and benchmark driver. An assertion or
acceptance rule *within* that machinery is an oracle. A fixture's predetermined
response can supply expected data, but merely serving it is not a verdict.

This distinction matters for interpreting a green benchmark: execution,
observation, and correctness are separate steps. A passing command exit code
reports the verdict of the checks the command actually ran. It does not imply
that every service behavior in the VM was checked.

## Current checks and their scope

| Check | Oracle or measurement | What a pass establishes |
| --- | --- | --- |
| Compose readiness and storage-driver check in [`compose_parallel.py`](../../platform/agent-execution/gondolin-session/benchmarks_py/compose_parallel.py) | Readiness/driver rules are narrow operational oracles; startup duration is a measurement. | Selected Compose services reached the configured ready state and Docker reported the requested driver. It says nothing by itself about a user journey. Docker explains that container startup alone does not guarantee readiness; health checks and `service_healthy` add a readiness condition ([Compose startup order](https://docs.docker.com/compose/how-tos/startup-order/)). |
| Flutter/Patrol assertions in [`voice_web_test.dart`](../../products/voice-agent/apps/client/patrol_test/voice_web_test.dart) and [`workspace_web_test.dart`](../../products/voice-agent/apps/client/patrol_test/workspace_web_test.dart) | Explicit UI oracles: expected widget presence/absence, text, navigation URL, and workflow state. | The observed UI matched those expectations after the scripted actions. Flutter's [`expect`](https://api.flutter.dev/flutter/flutter_test/expect.html) compares actual and matcher; [`findsOneWidget`](https://api.flutter.dev/flutter/flutter_test/findsOneWidget-constant.html) requires exactly one match. Patrol's own example also uses `expect` inside `patrolTest` ([Patrol documentation](https://patrol.leancode.co/documentation)). |
| Local HTTP fixture in [`patrol_fixture_server.clj`](../../products/voice-agent/apps/client/tool/patrol_fixture_server.clj) | Controlled input and expected response source, not an independent verdict. | The workspace journey can test UI behavior with stable server data. It does **not** prove that the Compose voice-edge implements the same behavior; the local [Patrol README](../../products/voice-agent/apps/client/patrol_test/README.md) identifies the fixture as the journey's backend. |
| [`inspect-patrol-trace.clj`](../../products/voice-agent/apps/client/tool/inspect-patrol-trace.clj) | Additional failure oracle: no missing/unreadable trace, unexpected network failure, HTTP status >=400, or console error, with specified cancellation exceptions. The trace file itself is evidence. | The recorded browser activity avoided those error classes. The script does not judge all page semantics or business correctness. Playwright describes traces as recorded actions, network, errors, console, and snapshots for inspection ([Trace Viewer](https://playwright.dev/docs/trace-viewer-intro)). |
| Host memory, swap, and free-disk guards in [`compose_parallel.py`](../../platform/agent-execution/gondolin-session/benchmarks_py/compose_parallel.py) | Resource-limit oracles; sampled values and timing are measurements. | The sampled host state stayed within configured floors/ceilings while the run executed. A duration becomes a performance oracle only when an explicit, justified threshold or comparison rule is applied. |

## What the current parallel result means

The current three-VM run starts three independent QEMU VMs, waits for their
selected dev Compose profile, then runs one Patrol suite in each VM in
parallel. The runner fails on a Patrol nonzero exit, failed trace-directory
capture, driver mismatch, or resource-limit breach. The Patrol script itself
fails if trace inspection finds no trace or detects its defined error classes. The benchmark
runner requires the trace directory copy to succeed; it saves the trace
summary JSON when available but does not independently parse that JSON as a
second verdict. The [benchmark result](../../platform/agent-execution/gondolin-session/benchmarks_py/benchmark-results.json)
records all three suites passing and six traces. The Patrol workspace journey
uses the local HTTP fixture, so this result is evidence for VM isolation,
Compose readiness, and the specified UI behaviors under load. It is not an
end-to-end verdict on the Compose voice edge or the full 15-service mock
profile.

To extend the oracle to those services, specify an externally observable
contract for each target behavior, drive requests through the actual Compose
endpoint, and assert its outputs and state transitions. Merely starting more
containers changes the environment and load, not the behavioral oracle. Keep
the expected outcome independent of the implementation under test where
possible; otherwise the test can repeat the same defect. The distinction
between test actions and expected results also appears in ISTQB's
[test-case definition](https://glossary.istqb.org/en_US/term/test-case).

## First implemented oracle

The optional [`oracle.clj`](../../platform/agent-execution/gondolin-session/tools/oracle.clj)
checks both saved Patrol trace ZIPs against the trace inspector's hashes and
error summary, requires browser and network activity, and checks for a
successful workspace message request. It sends a uniquely identified OTLP/JSON
canary span into the guest's collector and polls Tempo until that exact span is
returned. The [OTLP specification](https://opentelemetry.io/docs/specs/otlp/)
defines the `/v1/traces` HTTP endpoint and JSON encoding; the
[Tempo API](https://grafana.com/docs/tempo/latest/api_docs/) defines trace
lookup by ID. This Babashka CLI accepts the Patrol run directory, run ID, and
VM index; it prints one JSON verdict and exits nonzero on failure. The Compose
benchmark invokes it inside each VM, records the verdict, and fails if an
enabled oracle fails. The canary proves the collector-to-Tempo path; it is not
evidence that an application service emitted spans.

## Full-mock voice-edge extension

For `GONDOLIN_COMPOSE_PROFILE=full-mock`,
[`run-patrol-web`](../../products/voice-agent/apps/client/tool/run-patrol-web)
adds a third journey in the same VM. The browser types a turn through the
production Flutter widget tree and `VoiceApi`. A loopback relay supplies the
local ingress headers and forwards that request to the running Compose
voice-edge; it stores the edge's returned response in the fixture transcript.
This keeps the browser's read state deterministic while exercising the real
edge command and its inference-broker dependency. The outer inference broker
remains the profile's deterministic mock.

The relay supplies a fresh W3C `traceparent` for that one request. The edge
extracts it before the existing `browser.pi.turn` span, and Oracle requires
the browser trace to show a successful message request **and** Tempo to return
a `pipecat-voice-edge.browser.pi.turn` span with the same trace ID, service,
and operation. The [W3C Trace Context specification](https://www.w3.org/TR/trace-context/)
defines `traceparent`; OpenTelemetry's
[context propagation guidance](https://opentelemetry.io/docs/concepts/context-propagation/)
describes carrying it between services. This check ties a browser action to
an application emitted span; the separate canary continues to diagnose the
collector-to-Tempo path.

The [2026-10-21 one-VM qualification result](../../artifacts/benchmarks/compose-overlay2-1vm-2026-10-21T115521Z/result.json)
passed all three journeys and both telemetry checks. The live browser trace
recorded HTTP 200 for `/api/pi-message` with zero bad responses, network
failures, or console errors, and Tempo returned the matching edge span. This
is one successful run of the full-mock profile.

A [subsequent three-VM qualification](../../artifacts/benchmarks/compose-overlay2-3vm-2026-10-21T121723Z/result.json)
used a freshly built image. Each independent QEMU/Overlay2 VM started the
full-mock stack, passed all three Patrol journeys, and returned both its
unique canary and the live voice-edge application span from Tempo. All three
browser traces per VM passed inspection. This is one successful parallel
trial, not a measured reliability rate. The temporary host-built application
image archive was imported separately into each VM before Compose startup.

Allure sits above this verdict as a presentation and history layer. Oracle
emits one Allure test result per VM with browser-trace and OTEL steps, plus the
live-edge step in the full-mock profile, and the
verdict JSON as an attachment. Each test has a stable `historyId` for its VM
index, a fresh `uuid`, and an excluded run-ID parameter, matching Allure's
[test result format](https://allurereport.org/docs/how-it-works-test-result-file/)
and [history identifier rules](https://allurereport.org/docs/how-it-works-test-identifiers/).
The harness generates a per-run report and retains Allure 3's JSONL history
across generations using `historyPath`, as described in Allure's
[history documentation](https://allurereport.org/docs/history-and-retries/).
Allure displays and stores the verdict; it does not redefine the oracle rule.
