# Voice agent test report

From `products/voice-agent`, run `make allure-voice-agent` after the local deployment is
ready. The command runs deployed voice, diagnostics, and authenticated Grafana C4
Playwright journeys; route-fixture and Compose-backed knowledge tests; five
Compose-backed diagnostics scenarios; a
fixture-backed typed Pi boundary check between Voice Edge and the Inference Broker; four
Pi streaming scenarios through the production broker and a Clojure service mock; a
Flutter durable-task C2 mock journey and failure matrix; a deployed knowledge browser
review using one test-owned Oxigraph entry; a
fixture-backed persisted task diagram check, Flutter Patrol web voice and workspace journeys, MCP browser and contract
tests, a deployed MCP correction round trip through the live gateway and Oxigraph, a deployed
Wassette knowledge-retrieval probe, a fresh Grafana MCP/Tempo trace probe, the C4 dashboard
contract, gateway tests, and Rust knowledge-core tests. The knowledge probes create unique
fixtures and remove them afterward.
It writes an Allure report under the ignored
repository `artifacts/test-reports/<run-id>/report/` directory and records its path in
`artifacts/test-reports/latest.json`.
Run `make allure-durable` when validating the full durable path. It adds a real scratch task
through the owner browser route, approves it in the task board, waits for the isolated worker,
and downloads the workspace ZIP through the browser. The test verifies that ZIP contains the
unique file requested in the task. This opt-in run uses the authenticated tailnet browser bridge
and starts a real Pi task; the routine report omits it to avoid creating work on every run.
The report also contains `coverage-audit.md`, a generated matrix of passed cases by journey and
layer plus a C4 view and C2 element table. Those tables separate deployed, fixture, and
contract evidence so a mock does not count as execution of the production worker or store.
Machine-readable `coverage-audit.json`
is available in both the report and its run directory.
Run `make allure-c4-coverage` to refresh these tables from the latest completed
Allure results after changing a diagram or evidence mapping, without rerunning the journeys.

Playwright, Vitest, Node, gateway pytest, and Rust test cases appear individually. Playwright
cases carry their trace ZIPs and recorded screenshots, videos, and JSON evidence as attachments.
Evidence from every Playwright retry stays on the case, with its attempt number in the attachment
name; a test that passes after a failed attempt is marked flaky. The combined report permits one
voice retry so an intermittent offer 502 is preserved as flaky evidence with both traces rather
than disappearing from the report. Playwright and Patrol trace ZIPs
use Allure's Playwright trace media type so the report can open them in Trace Viewer. Patrol cases
also carry their HTML reports, screenshots on failure, and trace evidence. Screenshots and videos
keep their image and video media types for in-report previews. The trace viewer loads from
`trace.playwright.dev`, so opening it requires browser access to that site; the trace bytes remain
in the browser. If a Patrol journey fails before producing its HTML report or run summary, its
available trace still appears on the failed case; a missing expected journey produces a failed
command gate.

The Patrol workspace journey also attaches `fixture-evidence.json`. The runner fetches it from
the run-specific HTTP fixture and fails if the nonce, required browser mutations, final task
states, or fresh-session state do not match the journey. This proves the UI sent those requests
and the fixture applied them; it does not establish that the deployed durable worker ran.

The Playwright voice, knowledge, and diagnostics journeys call the official `allure.step()` API around
real Given, When, Then, and And blocks. The isolated Playwright image includes the Allure
Playwright reporter. The combined report copies those native step records, including their
measured duration and status, while omitting reporter hook and attachment housekeeping steps.
The local Grafana case has no execution steps when it is skipped. Other frameworks retain their
test-level results until they emit native step data; the report does not invent steps from titles.
A failed command or missing machine-readable result also produces a failed Allure gate with its
log attached. The report is private and can contain transcript and browser evidence.

The report's main navigation uses Allure's `epic → feature → story` hierarchy: **intended use →
user journey → validation layer**. Open a journey to see its user-facing black-box test first,
followed by deployed integration, app/fixture integration, observability, component contract, and
unit evidence. A layer appears only when a real test exists; an integration or unit result alone
does not imply that the whole journey was exercised. The numbered layer names keep this order in
the report. The original component capability and behavior remain on each result as
`capability` and `behavior` labels, alongside its actual suite and framework.

The diagnostics browser journey shares its `Given`, `When`, and `Then` step
functions between the deployed and C2 mock projects. `make playwright-diagnostics-c2-mock`
runs the mock profile, including empty, truncated, unavailable-list, and
unavailable-metrics scenarios. `make playwright-diagnostics` runs the deployed
profile. Both retain Playwright
traces and browser evidence; expected mock HTTP failures are asserted by
status and endpoint rather than hidden from the report. The older
`knowledge-base` suite uses `page.route()` fixtures and is labeled C3 browser
integration; `knowledge-c2-mock` crosses a separate Babashka service boundary.

| Layer | What it proves in this run | Examples |
| --- | --- | --- |
| User journey (black box) | Public app behavior and visible or durable outcomes | Playwright voice and diagnostics journeys; Patrol voice journey |
| Deployed integration (grey box) | Real process and data boundaries with controlled fixtures | MCP correction through the deployed gateway and Oxigraph |
| App and fixture integration (grey box) | MCP contracts and browser behavior with controlled inputs | Journal MCP contract; knowledge and diagnostics C2 mocks; Patrol workspace tests |
| Observability | A trace or health surface can be inspected | Trace viewer app tests; gateway health capability test |
| Component contract | An in-process API boundary and authorization behavior with mocked dependencies | Gateway pytest cases |
| Unit | Pure validation and serialization rules | Rust knowledge core |

The persisted task diagram test intercepts `/api/tasks` and is classified as browser integration;
it asserts that the browser read the fixture and attaches the read count; it does not claim the
task worker ran. The Grafana MCP probe attaches a bounded JSON receipt with
the fresh Tempo trace ID, dashboard UID, trace App URI, and PromQL expression. The Wassette probe
attaches its two checked outcomes for ranked knowledge and journal source retrieval. Both also
retain their command logs. The C4 dashboard contract verifies the generated views in-process;
the separate Grafana Playwright journey verifies that the running instance loaded and rendered them.

The `intent-taxonomy.mjs` rules group current cases under their intended use and journey from
the observable test title and suite. They describe test intent, not an independent product
requirement or full coverage claim. A new title without a known mapping keeps its suite and title
and receives the `intent-needs-review` tag. A skipped journey remains skipped, even when lower
layers pass. The deployed voice journey checks replay and metric outcomes, but the current report
has no standalone telemetry-ingestion test; the observability layer does not imply one.

## C4 traceability

The journey-first navigation stays primary. Each result also carries `c4System`, `c4Level`,
`c4Container`, and `c4View` labels from `c4-traceability.mjs`. The view filenames refer to the
[architecture source index](../../docs/architecture/README.md), where the Mermaid files are the
authoritative C4 model. The new C2 **Journal & Knowledge** and **Journal Review MCP** containers
represent the separately built React app and Pi's stdio MCP subprocess. The C3
[Journal & Knowledge view](../../docs/architecture/c3-journal-knowledge.mmd) shows the browser
components exercised by the knowledge journeys.

The mapping is deliberately narrower than a deployment diagram. A fixture-backed Patrol browser
test targets the Browser Voice Client, not the real task worker or queue. Gateway pytest targets
the Agent Gateway component boundary, not the deployed gateway. Rust core tests carry `c4Code`
without pretending that a shared library is a C4 container. The deployed voice turn references
the C1, C2, and D1 views because it exercises the browser-to-Pi route; the deployed MCP correction
references C2 and the Gateway C3 view. A skipped test retains its intended C4 mapping but does not
count as exercised coverage.

The `make test-pi-durable-mcp` suite records Given/When/Then steps for our Pi Durable
integration: MCP registration, host/Gondolin mode selection, a real Gondolin VM write,
and voice follow-up through the task socket. It attaches bounded JSON or text evidence.
The faux model replaces the external model provider; the real VM case runs when the
local Gondolin image is available. These cases exercise the owner-side integration
and tool boundary, not a deployed Gateway task or Pi Durable's internal behavior.
The combined report now includes this suite and its native Playwright traces. It also
includes the deployed `tailnet-owner-integration` case, which sends another identity
through Traefik's tailnet entry point and requires 403 for metrics and Oxigraph while
the configured owner still receives 200 for a bounded graph query. The test runs
inside Traefik's network namespace, so it checks Traefik and forward-auth, not
Tailscale Serve's identity stamping.
The `voice-telemetry` project completes one recorded-audio turn through the tailnet
bridge with a unique W3C trace ID. It verifies that the same trace contains the
Voice Edge session span and that the completed-turn OTel counter increased, then
attaches the trace ID, span names, and before/after metric values. The ordinary
local voice project keeps its browser and replay checks without requiring Grafana.
The combined report also runs the Python owner client against the Babashka C2 owner
service. Allure Pytest records native Given/When/Then steps for idempotent creation,
single and batch result queries, abort, retry, and owner failure. JSON receipts stay
attached to the steps; this fixture-backed integration does not count as a deployed
Pi Durable owner run.
Report generation fails if a result names a C2 container or C4 view missing from the
current Mermaid sources. This catches stale labels after architecture migrations.

The voice suite uses a recorded microphone fixture. Its Grafana MCP App case is skipped on local
ingress; run the separate tailnet ingress journey for that case. The report shows one run of these
suites. Gondolin Patrol Oracle has its own Allure history under
`artifacts/benchmarks/patrol-evidence/`; its earlier results are not counted as current knowledge
review results.

Run `make allure-publish` to copy the latest report into the read-only directory mounted by
`voice-edge`. The command prints its private path under `/knowledge/allure/<run-id>/index.html`.
The existing Tailscale ingress applies its owner identity check to that path. The local report
directory and its published copy are ignored by Git.
