---
type: reference
title: "One owner EventStorming Big Picture"
---

# One owner EventStorming Big Picture

**Question:** How does ordinary work become a reviewable outcome, and when can that outcome lead to an AWP change or replacement of one component in a selected repository? **Starts:** a need is expressed or an alert fires. **Ends:** the owner closes or follows up on work; a proposed change is held, rejected, verified, or recovered; a proposed regeneration run is held or its release is verified.

The [one integrated Structurizr DSL](one-big-wall.dsl) is the source for the [zoomable full-wall SVG](one-big-wall.svg) and [PNG](one-big-wall.png). It places **Phase 1 and Phase 2 notes beside their events on one canvas**. Each decision group contains a command, read model, command handler, deriver, repository/authority, candidate aggregate, and domain event. Arrows connect ordinary-work branches to owner review and then to AWP delivery or component regeneration. The [renderer](render_one_big_wall.py) validates and exports this DSL. The [event-only DSL](one-big-wall-events.dsl) and [Phase 2 context DSL](phase-2-aggregates-contexts.dsl) remain focused companion views. Phase 3 [policies](phase-3-policies.md) remain a detailed companion overlay.

This is **one tentative wall** prepared from repository evidence and prior conversation, not a live multi-role workshop. Event names are candidate business language. Arrows describe possible succession, not a shared event bus or a guarantee that all events are persisted. Orange notes are outcomes; blue notes are commands and handlers; green notes are read models; purple notes are derivers; gray notes are repositories/authorities; yellow notes are candidate aggregates. Structurizr groups label the decision's primary bounded context; cross-context contributions are detailed in [Phase 2](phase-2-aggregates-contexts.md). The group label distinguishes current, mixed, and proposed work.

[Phase 1](expanded-storming.md) specifies the decision mechanics behind every event cluster. [Phase 2](phase-2-aggregates-contexts.md) states each candidate aggregate's consistency rule and maps bounded contexts. Both are visible in the same event clusters on the full wall. [Phase 3](phase-3-policies.md) records event-triggered policies and refusal paths in its companion document.

## Walk the wall aloud

1. **A need or signal appeared.** The owner asked Pi a question or requested bounded work or a song. An operational alert can fire independently. A voice answer can be delivered without a durable task.
2. **Ordinary work reached an outcome.** A delegated request was accepted or refused. An accepted Pi Durable task captured a result or retained a failure. A completed turn could separately produce knowledge suggestions and a daily account; the owner accepted, corrected, or rejected knowledge. A song request could produce approved lyrics and audio, or stop at rejected lyrics or failed rendering. A selected alert could yield a bounded investigation finding or remain unjudged.
3. **The owner reviewed what happened.** Answer, artifact, failure, personal knowledge, daily account, audio, or finding came back for review. Work was closed, a follow-up was requested, or a specific improvement was nominated. A follow-up begins another pass; the visual does not impose a single global order on concurrent work.
4. **An AWP change was proposed.** A bounded change task produced an artifact and trusted measurements qualified or held it. A qualified change opened a PR. The PR diff led to lyrics, human lyric approval, audio rendering, and soundtrack attachment. PR review then approved the change or requested changes. Deployment verification passed or led to recovery or rollback. A missing soundtrack holds the PR if the soundtrack is required; an authorized exception could let review continue. That rule is still open.
5. **One component was proposed for replacement.** The owner nominated a component in AWP or another repository. The boundary and spec cut were accepted or held; a clean-room fence was verified or failed. Independent candidates were generated and measured; each could be held or unjudged. An eligible set informed a separate single-candidate decision. A selected candidate entered the **same AWP PR path when AWP was the target**, or the target repository's own PR and release path otherwise. Rejections and release failures remain visible. Reviewed findings can inform a later spec cut.

The proposed paths are conditional branches from reviewed evidence. Neither an alert nor a passing test automatically authorizes an AWP production change or component promotion.

## Pivotal events and parallel work

| Pivotal event | What changes afterward |
| --- | --- |
| Need expressed or signal noticed | A conversation, delegated task, creative request, or operational investigation can start. |
| Task accepted | Pi Durable has one task identity; result and failure paths become inspectable. |
| Outcome reviewed | The owner can stop, follow up, nominate an AWP change, or consider component replacement. |
| Spec cut ratified | Independent candidate generation can be judged against one pinned obligation set. |
| One candidate selected | One candidate digest may enter the target repository's PR process. |
| AWP deployment verified | The selected revision passed post-deploy checks; later operational evidence may still change the next spec. |

Knowledge extraction, the daily account, and direct answers need not finish in a particular order. Candidate generation and measurements are per candidate; the combined “independent candidates generated” note is a compressed parallel cluster, **not** a serial A-then-B sequence. The [component process walk](component-regeneration-walk.md) carries candidate identities and the convergence rule.

## People, systems, and decision ownership

| Participant or system | Place on this wall |
| --- | --- |
| Owner | Expresses needs, reviews outcomes and personal knowledge, nominates consequential changes. |
| Pi and Pi Durable | Conduct conversation; accept bounded tasks and retain outcomes. |
| Coding sandbox | Produces an AWP change artifact or isolated component candidates. |
| Independent measurement gate | Qualifies an AWP artifact or records candidate measurements; a generator cannot judge its own output. |
| Lyric generator, renderer, PR reviewer | Produce and approve the PR soundtrack before repository review completes; exact exception rule remains open. |
| Repository maintainer and release operator | Review the target repository PR, select release actions, verify or recover deployment. |
| Monitoring and alerting | Supply health evidence and selected alerts for investigation; they do not own promotion decisions. |

These roles are hypotheses for a live walkthrough. Some can be the same person in practice; the decision rights still need to be stated explicitly.

## Process grammar behind the event wall

The original event-first [Structurizr Big Picture](one-big-wall-events.svg) remains available, while the integrated wall adds design-level notes around each event. The [day-to-day walk](owner-workday-walk.md), [AWP change walk](event-storming-walk.md), and [component regeneration walk](component-regeneration-walk.md) supply the process-level detail. The most important decisions to test with participants are:

| Decision | Actor and attempted action | Information needed | Successful outcome | Refusal or failure outcome |
| --- | --- | --- | --- | --- |
| Delegate work | Owner or authorized caller submits a bounded task | Identity, request ID, workspace, allowed task input | Task accepted | Task request refused |
| Qualify AWP change | Independent gate judges the artifact | Diff, required measurements, oracle version, provenance | AWP change qualified | AWP change held |
| Review PR soundtrack | Reviewer approves lyrics; renderer produces audio | PR diff, full lyric manifest, audio artifact | PR soundtrack attached | PR soundtrack held; exception policy unresolved |
| Ratify component cut | Component owner approves a spec cut | Boundary, behavior sources, invariants, gate, provenance | Spec cut ratified | Boundary or spec cut held |
| Select one candidate | Authorized reviewer selects one digest | Complete eligible set, current base revision, competing selection | One candidate selected | Candidate selection refused |
| Release change | Repository reviewer and operator approve and verify | PR, checks, selected digest, rollback evidence | Deployment or component release verified | Changes requested, release held, or recovery recorded |

A business refusal is distinct from a technical failure; the detailed walks should preserve that distinction. A failed command is shown as a durable business outcome only where someone must react to it.

## Hot spots for the live session

- **H1 · Initiation:** Who may turn a finding into an AWP change? A selected alert can start a bounded investigation; broader automatic change authority is unresolved.
- **H2 · Boundary:** Can the nominated component be deleted without losing behavior or crossing another component's write authority?
- **H3 · Selection:** Who ratifies the spec cut and chooses one eligible candidate when several qualify, especially outside AWP? How is a competing choice refused?
- **H4 · Soundtrack:** Does missing or rejected PR audio block review, or can a reviewer record an exception?

Use the [Brandolini method note](brandolini-research.md) to run a narrated walkthrough with owner, operator, repository maintainer, and gate perspectives. Ask them to move or rename events, challenge the branch order, and resolve or assign each hot spot. The [C4 workspace](workspace.dsl) documents software boundaries separately from this business timeline.
