---
type: reference
title: "Phase 2 — aggregates and bounded contexts on the big wall"
---

# Phase 2 — aggregates and bounded contexts on the big wall

This is the second overlay on the [one big EventStorming wall](one-big-wall.md), using [Phase 1 decision points D1–D15](expanded-storming.md). It asks two questions: **which decisions need one consistent version of state**, and **where does a word or decision authority change meaning**? The boundaries below are candidate domain boundaries, not a deployment diagram, package plan, or claim that the proposed workflows already run. Phase 3 will add policies to these boundaries.

Open the [zoomable Structurizr SVG](phase-2-aggregates-contexts.svg) or [PNG](phase-2-aggregates-contexts.png). The [editable DSL](phase-2-aggregates-contexts.dsl) is the source for the compact context map; the tables below carry the decision detail.

## Aggregate candidates

An aggregate protects a rule that must survive concurrent commands. Its identity and version matter more than the class or database chosen to implement it. A read model assembled from other owners is not automatically an aggregate. The final column distinguishes existing consistency mechanisms from proposed domain boundaries.

| Aggregate candidate and Phase 1 decisions | Identity / consistency question | State authority | Status |
| --- | --- | --- | --- |
| **A1 · Voice Session** · D1 | One session ID orders accepted turns and makes an interruption distinct from a completed response. A turn can suggest follow-on work without owning that work's lifecycle. | Pi Voice session and public transcript/diagnostics. | Current language and runtime. |
| **A2 · Task Request** · D2, D5, D7 | One stable request ID may map to one canonical input and one native task. A conflicting retry must not replace the mapping. The owner agreed that transport retries reuse the task. | Pi Durable owner `Requests` document and the native task creation commit. | Current owner deduplication; Gateway stable-ID contract still to implement. |
| **A3 · Agent Task** · D3, D9 | One task ID owns checkpoint, progress cursor, terminal state, abort and retry disposition. A failure after acceptance must remain queryable; another task cannot overwrite its result. | Pi Durable native task state; workspace and artifact are referenced effects, not fields guaranteed atomic with every checkpoint. | Current. |
| **A4 · Knowledge Item Review** · D4 | One journal entry or candidate assertion has attributable source and append-only owner review actions. A correction or rejection should change that item's current interpretation without rewriting its history. | Oxigraph review history and knowledge projection. | Current records; atomicity of history and projection needs validation. |
| **A5 · Daily Journal** · D5 | One owner/date/time-zone/source-set identity produces one daily account; a new source set is a different revision or request, not an invisible replacement. | Pi Durable build request and bounded journal writer. | Current task identity; document version semantics need review. |
| **A6 · Song Generation** · D6, D10 | One generation ID associates one lyric task and at most one render task. A render needs a valid manifest. The owner's lyric approval is presently a manual workflow fact, not an enforced durable state transition. | Pi Durable lyric/render tasks and artifact projection through SongService. | Logical candidate over current tasks; approval recording is a gap. |
| **A7 · Alert Incident** · D7 | One managed rule/fingerprint/incident epoch determines whether a firing alert has already started its bounded investigation. A recurring alert after cooldown may start a new epoch. | Host monitor SQLite incident row; Pi Durable owns the investigation task separately. | Current. |
| **A8 · AWP Change Case** · D8–D11 | One evidence-linked improvement tracks nominated change, selected task artifact/revision, qualification decision, PR link, and release disposition. A green measurement cannot silently change the chosen revision. | No single current owner; proposed change-decision record. Git PR and deployment remain external authorities. | Proposed. |
| **A9 · Component Specification** · D12 | One component identity has versioned spec cuts. Ratification creates an immutable cut digest; later learning proposes a new cut rather than altering evidence already used by candidates. | Proposed versioned spec bundle in the target repository or OCI artifact store, under component-owner review. | Proposed. |
| **A10 · Regeneration Run** · D13–D14 | One run pins repository, component, base revision, spec digest and boundary version. Candidate IDs and evidence stay distinct even when generated and measured in parallel. A failed candidate does not erase a sibling. | Proposed run ledger and immutable per-candidate evidence; the independent gate owns measurement verdicts. | Proposed. |
| **A11 · Candidate Selection** · D14–D15 | One decision version for a repository/component/base selects at most one eligible digest. Two simultaneous selections cannot both claim promotion authority; a stale base is refused. | Proposed versioned selection record plus target Git base check. | Proposed. |
| **A12 · Repository Change** · D10–D11, D15 | One PR/revision receives review and soundtrack when applicable. The approved commit is pinned; a later deployment result is a separate fact referencing it. AWP and another repository have separate review owners. | Git host and repository reviewers; this is **external** to the proposed regeneration run. | Existing manual repository authority; cross-path wiring proposed. |
| **A13 · Deployment Attempt** · D11, D15 | One target revision and environment receive one verification outcome, failure, or recovery action. A successful PR review cannot stand in for a successful deployment. | Operator workflow and verification reports; no single first-class durable run record is established. | Logical candidate, not a current unified aggregate. |

### Things deliberately outside an aggregate

- **Owner outcome review** is a human decision that may start a new process. The task, knowledge entry, song, and alert retain their own identities; there is no global “workday aggregate.”
- **Measurement evidence and oracle output** are immutable, attributable inputs to a qualification or candidate-selection decision. Their projection may converge under parallel delivery, but it does not choose a winner or deploy anything.
- **Agent Session and Workspace Mount** are execution boundaries. A task references them while it runs; the Tasking Context owns task acceptance and terminal state.
- **PR soundtrack** crosses Song Generation and Repository Change. It is a correlated process, not proof that a song artifact and a Git PR can be committed atomically.

## Bounded-context map

A bounded context owns the meaning of its words and decisions. Several contexts may run in one process or live in one repository. `Current` here means the language and authority are evidenced today; a `Proposed` row is a modeling boundary to validate, not a new service requirement.

| Context | Owns the meaning of | Receives / publishes at its boundary | Status |
| --- | --- | --- | --- |
| **C1 · Voice Conversation** | Voice Session, Turn, answer, interruption. | Sends a bounded task request to C2; supplies source-turn evidence to C3. A response can end without delegation. | Current product language. |
| **C2 · Tasking** | Task Request, Agent Task, task progress/result, Song Generation task lifecycle, artifact reference. | Accepts work from C1 or C4; asks C8 to execute; returns task identity and outcome. Song audio is exposed through the product API. | Current [Voice Agent glossary](../../products/voice-agent/GLOSSARY.md). |
| **C3 · Personal Knowledge** | Candidate Assertion, Review Event, Daily Journal, Profile Fact. | Receives attributed turn evidence and task effects; owner review changes interpretation. It does not decide an AWP release. | Current product language; review projection boundary needs validation. |
| **C4 · Operational Incidents** | Managed alert, incident epoch, bounded investigation finding. | Reads Grafana/Prometheus; submits one investigation request to C2 and offers a finding to C6. | Current host monitor; distinct decision language from product changes. |
| **C5 · Measurement and Qualification** | Tool measurement, oracle qualification, behavior baseline, pass/fail/unjudged verdict. | Receives candidate artifact/digest from C6 or C7; returns attributable evidence and a verdict. It cannot select a candidate or authorize release. | Measurement tooling current; unified decision contract proposed. |
| **C6 · AWP Change Governance** | Improvement nomination, evidence link, qualification acceptance, selected AWP revision, release readiness. | Consumes C2 task results, C4 findings, C5 verdicts; requests AWP PR/release from C9. | Proposed cross-path context. |
| **C7 · Component Regeneration** | Component spec cut, clean-room run, candidate, eligible set, selected digest. | Consumes C5 measurements; sends one selected candidate to C9. When AWP is the target, C6's change/PR path also applies. | Proposed. |
| **C8 · Agent Execution** | Agent Session, Workspace Mount, Capability Surface. | Receives bounded execution from C2; returns tool/session outcome. It does not decide task admission, owner review, or PR promotion. | Current [platform glossary](../../platform/agent-execution/GLOSSARY.md). |
| **C9 · Repository Delivery** | PR, review disposition, target revision, deployment/release verification. | Receives qualified AWP or selected component change; returns distinct review and release evidence to C6/C7. Each target repository retains its own authority. | Existing Git and operator authority; proposed integration with C6/C7. |

**Map, not topology:** C1/C2/C3 are product vocabulary, C8 is the existing platform vocabulary, and C9 is the repository's own governance. C4 currently lives in a host monitor, while C5–C7 express the emerging cross-path model. None of these arrows asserts a shared production event bus.

```text
C1 Voice Conversation ──task request──────▶ C2 Tasking ──execution──────▶ C8 Agent Execution
        │                                      ▲
        └──source turn────────────▶ C3 Personal Knowledge
C4 Operational Incidents ──investigation────┘
        │
        └──finding───────────────▶ C6 AWP Change Governance ◀──verdict── C5 Measurement
                                     │                                ▲
                                     ▼                                │
                              C9 Repository Delivery ◀──selection── C7 Component Regeneration
                                     ▲                                │
                                     └────── AWP-target join ─────────┘
```

The diagram is a communication sketch. The [Structurizr C4 workspace](workspace.dsl) remains the software and deployment model; it should not be reinterpreted as this domain map.

## Boundary tests from the wall

1. **Same intent, uncertain response:** A caller retries a delegated request after the owner may have committed. C2 must resolve the stable ID against A2; a new task ID would violate the owner's agreed rule. C1 does not own the retry mapping.
2. **Completed task, missing artifact:** A3 can be terminal while an artifact lookup fails. Artifact availability is a separate referenced effect; C2 reports the lookup failure without rewriting native task completion.
3. **Parallel candidate arrivals:** A10 may collect candidate B's measurements before A's. C5 can produce a converged eligible set when complete evidence arrives; A11 still needs one versioned human selection.
4. **Regeneration in another repository:** C7 sends a selected digest to that repository's C9 process. AWP's soundtrack and deployment rules do not silently become rules for the other repository.
5. **Operational alert to code change:** A7 may trigger a bounded investigation through C2. C6 requires its own nomination authority; an alert alone cannot create or release an AWP change.
6. **Song and PR are out of sync:** A6 can finish while A12's PR changes. A PR soundtrack must refer to the reviewed diff and a reviewer-accessible, pinned audio artifact; the two owners cannot be treated as one transaction.

## Hot spots to resolve before fixing boundaries

- **H1 · Task admission:** The Gateway currently creates a new request ID per call; the owner chose stable identity across retries. Which canonical fields define “same intent,” and how is uncertain commit reconciled?
- **H2 · Knowledge review:** Are review history and current entry interpretation one consistency boundary in Oxigraph? Verify correction/removal paths before calling A4 a single aggregate.
- **H3 · Song approval:** Where is lyric approval recorded and versioned? `decide_render` checks a valid completed manifest and render state, but the current service does not prove a durable approval action.
- **H4 · Change authority:** Who owns C6 nomination and release readiness? The present evidence sources and PR workflow have no single current change-case owner.
- **H5 · Candidate selection:** Is A11 scoped to one run, or must it serialize all runs competing for the same repository/component/base revision? The proposed CAS rule needs that identity defined.

Phase 3 will write policies as **“Whenever [event], if [read model], issue [command] or record [refusal]”** against these boundaries. It will keep human approval distinct from deterministic gate verdicts and specify what happens after timeout, duplicate delivery, stale base, and failed external effects.

### Evidence anchors

[Voice Agent glossary](../../products/voice-agent/GLOSSARY.md) · [Agent Execution glossary](../../platform/agent-execution/GLOSSARY.md) · [Pi Durable owner](../../platform/agent-execution/pi-durable-task/owner.ts) · [song lifecycle deriver](../../products/voice-agent/packages/tasking/src/voice_agent/tasking/domain/song_lifecycle.py) · [alert monitor](../../products/voice-agent/tools/ops/stack_alert_monitor.py) · [component regeneration walk](component-regeneration-walk.md) · [regeneration pilot](../plan/03-component-regeneration/plan.md) · [parallel-source simulation](parallel-source-simulation.md).
