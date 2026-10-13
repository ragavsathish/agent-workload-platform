# 0002: Layer the Voice Agent server by bounded context

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

Use a `src/voice_agent` package with `speech` and `tasking` bounded contexts.
Within each context, separate domain or application logic from infrastructure
and presentation adapters. Tests mirror those roles. Database migrations stay
at the server root because they are release artifacts, not importable domain
code.

| Driver | Initial reason | Evidence or constraint | Trade-off | Assessment |
| --- | --- | --- | --- | --- |
| Local reasoning | A developer should find all speech or task behavior without inspecting the other context | Speech deploys as a host broker; tasking deploys as a gateway and worker | Shared telemetry remains outside both contexts | Supported |
| Honest dependencies | Framework and vendor code should not appear to be domain logic | FastAPI, MLX, Postgres, Absurd, and S3 have clear adapter roles | The existing task service still composes its concrete adapters | Supported with documented follow-up seam |
| Deletion and replacement | MLX or the durable queue should be replaceable without renaming domain concepts | Model and queue choices are implementation details | Adapter extraction is incremental | Supported |

## Consequences

Runtime commands use package module paths and set `PYTHONPATH=src`. Docker and
host installers copy the package tree instead of selected flat files. New code
must use the `Speech Inference Context` or `Tasking Context` language and place
tests in the matching layer. The removed legacy server bot must not be restored;
the Pipecat voice pipeline is owned by `edge/`.
