# C2 container mocks for fast UI development

These Babashka modules replace public C2 protocols in an isolated test process.
Each module owns one bounded state machine and exposes `route?`, `transition`,
and boundary metadata. The fixture server dispatches requests and serves built
Flutter or React assets. The mocks are outside the deployed Voice Agent system.

| Module | C2 boundary represented | UI consumer | Scenarios |
| --- | --- | --- | --- |
| `journal.clj` | Oxigraph query, Voice Edge owner review, Gateway correction | React knowledge browser and journal MCP | Query, correction, deletion, assertion review, invalid request, missing entry, unauthorized command |
| `diagnostics.clj` | Voice Edge diagnostic replay API | React diagnostics | Ready, empty, truncated, unavailable list, unavailable metrics, unknown session, invalid method |
| `broker.clj` | Inference Broker Pi completion API | Voice Edge typed-turn adapter | Ready, upstream unavailable, malformed completion, empty response, rejected request, unauthorized request |
| `pi_voice.clj` | Pi Voice streaming endpoint | Production Inference Broker | Ready deltas, malformed event, in-stream error, unavailable upstream |
| `durable.clj` | Durable task proposal, approval, result, and artifact API | Flutter task board | Scratch completion, worker failure, owner outage, repository unavailable, approval conflict, cancellation, invalid proposal, missing artifact |
| `pi_durable_owner.clj` | Private Pi Durable task owner protocol | Agent Gateway | Completion, duplicate request, changed input, failure, abort, retry, owner outage, invalid token |
| `../patrol_fixture_domain.clj` | Voice Edge conversation, transcript, session and task routes | Flutter Patrol web | Conversation, stop, context, session changes, task approval/cancellation |

`GET /__fixture/c2/boundaries` lists the mocked contracts. Module-specific
evidence endpoints return the selected state and recorded requests. For a
failure scenario, tests must assert the exact expected HTTP error and the UI
message. Unexpected browser errors still fail the test.
The common `deploy/compose.c2-mock.yml` is layered with a knowledge,
diagnostics, or durable overlay so
each C3 app builds and mounts independently.

Run from `products/voice-agent`:

```sh
make playwright-knowledge-c2-mock
make playwright-diagnostics-c2-mock
make playwright-durable-c2-mock
make test-voice-edge-c2-mock
make test-broker-pi-stream-c2-mock
make playwright-knowledge-live
npm --prefix apps/client run test:mock
```

The mock browser suites and the deployed browser suites use separate Playwright
projects and Allure validation-layer labels. The diagnostics journeys share
their `Given`, `When`, and `Then` steps. Compose chooses the mock services;
the test body does not switch its expectations based on an environment flag.

| UX container | Fast profile | Deployed or full-flow evidence |
| --- | --- | --- |
| Browser Voice Client (Flutter) | `playwright-durable-c2-mock` plus Patrol workspace and sessions | Patrol voice and opt-in durable Playwright; a paired full durable run starts a real task |
| Input Diagnostics (React) | `playwright-diagnostics-c2-mock`, five success and failure flows | `playwright-diagnostics`, using a real saved replay |
| Journal & Knowledge (React) | `playwright-knowledge-c2-mock`, saved correction round trip | `playwright-knowledge-live` creates one unique graph entry, reviews it through the deployed browser, verifies persistence, and deletes its triples and review event |

Shared React knowledge widgets are exercised through the knowledge browser
tests and MCP App browser tests; they are code shared across consumers, not a
separate C2 container. The full-flow tests remain the release confidence gate.

The first seam below Voice Edge is checked by `apps/edge/test_c2_broker_mock.py`:
it calls the production typed-turn adapter over HTTP to the Babashka broker
mock and verifies both the public response and error normalization. The next
streaming seam is checked by the production broker against `pi_voice.clj`.
The durable C2 module covers the UI-facing task contract but does not run the
real Pi Durable owner, Gondolin VM, or storage adapter. Those remain paired with
the opt-in full durable journey.
The separate `pi_durable_owner.clj` exercises the production Gateway client at
the next C2 seam. Its state machine is available as an in-process test or a
small HTTP server, and the Python adapter test calls that server over HTTP.
The host-native broker, Pi Voice Service, worker, builder, and observability
processes are macOS LaunchAgents in `deploy/launchd/`; “host services” refers
to that deployment location, not to one shared API. Each mock for those seams
should live in its own module and be checked against its production protocol.
