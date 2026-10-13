# 0002: Separate Voice Agent apps from shared bounded-context packages

Status: Accepted

## Context

The Voice Agent server placed speech inference entrypoints, MLX adapters,
task-domain policies, FastAPI schemas, Postgres access, queue workers, and
telemetry in one directory plus a generic `orchestrator` package. Directory
names described process history rather than the product language, so a change
to transcription or durable task approval required reading unrelated modules.

## Options Considered

| Option | Benefits | Drawbacks | Evidence or unknowns |
| --- | --- | --- | --- |
| Keep a flat server and `orchestrator` package | No path changes | Boundaries and dependency direction remain implicit | Speech and durable task code have different language, deployment, and reasons to change |
| Organize only by technical layer | Matches many Clean Architecture examples | One feature remains scattered across every layer | This server has two independently deployed bounded contexts |
| Organize by bounded context, then layer | Keeps a change local while making domain/application/infrastructure/presentation roles visible | Some framework wiring remains context-local and paths become longer | `speech` and `tasking` already map to separate runtime capabilities and glossary terms |

## Decision and Rationale

Use independently deployable roots under `products/voice-agent/apps`. Keep the
speech implementation in the broker app because it has one process owner. Put
the tasking domain, application, persistence, artifact code, and migrations in
`packages/tasking` because both gateway and worker consume that seam. Put the
payload-free Python telemetry adapter in `packages/telemetry` because edge,
gateway, and broker consume it. Transport and process entrypoints remain in
their owning apps. Tests follow the code they verify.

| Driver | Initial reason | Evidence or constraint | Trade-off | Assessment |
| --- | --- | --- | --- | --- |
| Local reasoning | A developer should find all speech or task behavior without inspecting the other context | Speech deploys as a host broker; tasking deploys as a gateway and worker | Shared telemetry remains outside both contexts | Supported |
| Honest dependencies | Framework and vendor code should not appear to be domain logic | FastAPI, MLX, Postgres, Absurd, and S3 have clear adapter roles | The existing task service still composes its concrete adapters | Supported with documented follow-up seam |
| Deletion and replacement | MLX or the durable queue should be replaceable without renaming domain concepts | Model and queue choices are implementation details | Adapter extraction is incremental | Supported |

## Consequences

Runtime commands compose each app source root with only its shared package
roots. Docker and host installers copy those explicit roots. Every deployable
Python app owns a lock file; shared packages do not own process startup. New
code must use the `Speech Inference Context` or `Tasking Context` language and
place tests with the owning app or package. The Pipecat voice pipeline is owned
by `apps/edge/`.
