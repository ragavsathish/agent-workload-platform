# EventStorming and C4 model

Audience: maintainers and domain participants deciding where behavior changes
belong. Scope: the Voice Agent product, its host image work, and its
deployment/verification workflows. The source is the [product journeys](../evidence/allure/index.md),
[automation behaviors](../spec/ansible/index.md), and [host component behaviors](../spec/go/index.md),
checked against the current [C2 architecture](../../products/voice-agent/docs/architecture/c2-container.mmd)
and owner, image-job, and knowledge implementations.

Start with the [one big EventStorming wall](one-big-wall.md). Its
[single integrated Structurizr DSL](one-big-wall.dsl) defines the event,
Phase 1 decision notes, Phase 2 aggregate notes, context groups, and their
relationships. The [renderer](render_one_big_wall.py) validates that DSL and
exports its [SVG](one-big-wall.svg) and [PNG](one-big-wall.png).
The [event-only](one-big-wall-events.dsl) and
[context](phase-2-aggregates-contexts.dsl) Structurizr sources remain focused
companion views.
The [phase-by-phase expansion](expanded-storming.md) overlays the entire wall. Phase 1 maps read models, command handlers, derivers, and repositories; [Phase 2](phase-2-aggregates-contexts.md) groups aggregates and bounded contexts; the [delegated-task admission detail](delegated-task-admission.md) drills into one decision. [Phase 3](phase-3-policies.md) adds policies.
The [bounded-context Gherkin specs](../spec/contexts/index.md) state the rules behind
those boundaries. The [owner journey slice](../plan/04-owner-work-to-release/spec.feature)
composes them into cross-context scenarios with stable rule references.
The [tentative owner workday wall](owner-workday-walk.md) zooms into
conversation, delegated work, knowledge, songs, operations, and follow-up.
Its [Structurizr SVG](owner-workday-walk.svg) or [PNG](owner-workday-walk.png)
shows where the owner acts across these day-to-day paths. The AWP improvement
branch expands into the [one EventStorming walk](event-storming-walk.md) and its
[Structurizr SVG](event-storming-walk.svg) or [PNG](event-storming-walk.png).
That walk follows one AWP improvement from voice and evidence through a durable
task, coding sandbox, PR soundtrack, release, verification, and the next
observation.
The proposed [component regeneration walk](component-regeneration-walk.md)
branches from the same owner wall for any selected repository; its
[Structurizr SVG](component-regeneration-walk.svg) shows parallel candidates,
an independent gate, and one reviewed promotion decision.
The [operating-loop synthesis](orchestrator-theme.md) is a shorter systems view.

The [supporting Big Picture slices](big-picture.md) expand the branches. Their editable
[Structurizr EventStorming workspace](event-storming.dsl) defines five custom
views, and the [PNG board](big-picture.png) is rendered from those views by
`make event-storming-render`. The renderer validates the DSL with the current
Structurizr image, exports PlantUML for each view, renders those views, and
stacks their PNGs into the board.
The
[process model](process-model.md) adds commands, policies, read models, and
refusal paths. The [storming index](storming.md) reviews the earlier draft and
maps every source feature. The [Brandolini research note](brandolini-research.md)
explains why these are separate artifacts and cites the method's primary sources.
The [Structurizr workspace](workspace.dsl) is the editable C4 architecture view,
with focused container views and six ordered dynamic views. The task-to-sandbox
bridge shows how a durable task reaches a separate coding VM, including the
conditional image handoff and the host-mode alternative.
The separate [event-sourcing proposal](event-sourcing-proposal.md) and
[proposed C4 workspace](event-sourcing-proposal.dsl) show a possible append-only
task history without presenting it as current behavior.
The [parallel source simulation](parallel-source-simulation.md) replays a
synthetic cross-owner improvement scenario through shuffled, duplicated event
deliveries and records whether its proposed read model converges.
The [LLM persona simulation](persona-simulation.md) lets local model personas
make the owner, runtime, qualification, lyric, and release decisions before
replaying the events they admit.
`Given` is a precondition, `When` may be a command or stimulus, and `Then` is an
observable outcome. Only some outcomes become candidate domain events. A
past-tense name here is **analysis vocabulary**, not proof that the system
publishes or stores that event. This desk-derived board needs a narrated
walkthrough with domain participants; it is not a completed collaborative workshop.

## Current persistence boundary

| Behavior | Current durable record | Event-sourced? |
| --- | --- | --- |
| Delegated task lifecycle and bounded progress | Pi Durable native SQLite checkpoint and result | No claim of an append-only event stream; state and progress are persisted by one owner. |
| Journal corrections and assertion reviews | Append-only feedback/review records in Oxigraph | Event-like history exists for reviews; the whole knowledge graph is not modeled as event-sourced. |
| Image build and Compose cache job status | In-memory host job store; image handoff files | No. A process restart can lose job status; artifacts may remain. |
| Deployment and verification | Service state, test reports, metrics, traces | No. These are observed outcomes, not one canonical event log. |

EventStorming does not require event sourcing. The current-state C4 model
introduces no broker, topic, or new event store. If durable replay is
required later, decide the aggregate, event schema, ordering, idempotency key,
retention, and projection rebuild rule in an ADR before adding infrastructure.

## Reading the views

| View key | Question |
| --- | --- |
| `work-and-review` | Which containers own delegated work and journal review? |
| `build-and-operations` | Where do image preparation, deployment checks, and measurements run? |
| `delegate-work` | How does a user request become a durable task and result? |
| `delegate-work-host` | How does the same public task run with host coding tools? |
| `process-completed-turn` | How do journal and classification jobs remain durable while using bounded product effects? |
| `review-knowledge` | How is a correction recorded and read back? |
| `prepare-image` | How does a repository cache miss supply the task coding VM? |
| `verify-deployment` | How does an operator obtain deployment and telemetry evidence? |

The dynamic arrows are ordered interactions among C4 containers. Candidate events
and refusal paths are in the Big Picture and process model. A failed command
does not imply a successful domain event.
Run `make event-model-check` to verify that every source feature is mapped on the
board. Validate the DSL workspaces with the Structurizr CLI before publishing
rendered diagrams.

## Open decisions

1. Should the host image-job API persist job identity and state across restarts?
   The current in-memory store does not give durable job replay.
2. Which task transitions, if any, need an append-only business history beyond
   Pi Durable checkpoints and the bounded public progress projection?
3. Should deployment verification outcomes be retained as a first-class run record,
   or remain reports and observability measurements?

This is an architecture analysis of current behavior, not an implementation change.
