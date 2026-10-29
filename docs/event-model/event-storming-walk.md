---
type: reference
title: "One EventStorming walk: AWP learns from evidence and changes safely"
---

# One EventStorming walk: AWP learns from evidence and changes safely

**Question:** How can a Voice Agent observation become a reviewable AWP production
change, including the PR soundtrack, and then return as fresh evidence?
This is the production-change branch of the broader
[owner day-to-day work wall](owner-workday-walk.md). Ordinary questions,
delegated research or coding, knowledge review, song creation, and operational
investigation may finish without an AWP change or PR.
**Audience:** owner, product maintainer, task-runtime maintainer, reviewer, and
operator. **Scope:** one candidate AWP improvement and its next observation.
This is a desk-derived walk from code, Gherkin, and the
[PR soundtrack guide](../wow/pull-request-soundtrack-workflow.md), not a facilitated
workshop or a claim that the proposed cross-path automation is deployed.
It applies Brandolini's event-first timeline, pivotal events, Hot Spots, and
process grammar as summarized with [primary sources](brandolini-research.md).

The [Structurizr source](event-storming-walk.dsl) renders to a single
[zoomable SVG](event-storming-walk.svg) and [PNG](event-storming-walk.png).
Orange notes are **candidate past-tense events**. Red outlines mark pivotal
events. Blue is a command, lilac a policy, green the evidence needed for a
decision, and pink an unresolved Hot Spot. Purple outlines mark outcomes or
policies in the proposed improvement loop. None of these event names implies a
published message or an event-sourced store.

## Narrate the walk from left to right in time

1. **A turn completes.** The owner can delegate directly from voice, and the
   completed turn can separately create journal and classification tasks. Their
   attributed output becomes reviewable knowledge. The owner may correct or
   review it. This branch runs concurrently with other work; it is not a
   prerequisite for every AWP change. [Completed-turn contract](../evidence/allure/features/digital-twin--process-a-completed-owner-turn.feature),
   [review contract](../evidence/allure/features/knowledge-and-review--correct-and-review-journal-knowledge.feature).
2. **An improvement is selected.** A person or future governed policy reads
   reviewed knowledge, bounded task results, test measurements, oracle status,
   metrics, traces, and alert findings. It chooses one evidence-linked AWP
   change request. This selection policy and its authority are **proposed**;
   available evidence does not itself authorize a code change. **H1** asks who
   decides, with what threshold, and how duplicate findings are linked.
3. **The change task is submitted and accepted.** The owner or authorized
   policy issues `Submit change task`; Pi Durable records one task identity.
   Admission and idempotency already exist for product tasks. The proposed
   orchestration is the decision to submit this specific AWP improvement.
   [Durable-work contract](../evidence/allure/features/durable-work--continue-durable-work.feature).
4. **The workspace and execution route are prepared.** The selected AWP
   revision becomes a task workspace. In Gondolin mode the task uses a default
   or verified cached image; a repository image cache miss invokes the separate
   shared builder, whose verified handoff returns to image resolution. Then the
   per-task VM starts with `/workspace` mounted read/write. Host mode starts
   host tools against the same task contract. The shared builder VM and task VM
   have different responsibilities. The current owner routes `agent-run` and
   `song-lyrics` through Pi task sessions; journal, classification, daily
   journal, and song render use bounded host effects.
   [Task runtime](../../platform/agent-execution/pi-durable-task/session-execution.ts),
   [image behavior](../spec/go/image_build.feature).
5. **An AWP change is produced and captured.** For the proposed improvement
   request, coding tools change the selected AWP workspace. The owner captures
   a bounded task result and artifact. If tools fail, the native task retains a
   queryable failure; no successful change event or PR follows.
6. **The change is qualified.** A proposed policy compares relevant behavior
   measurements with an accepted baseline. The
   [measurement oracle](../plan/02-allure-behavior-baseline/measurement-oracle.md)
   must first qualify the tools that supplied them. A pass yields `AWP change
   qualified`; a fail or unjudged result yields `AWP change held`, a stable stop
   before PR or release. **H2** asks which checks and vetoes apply.
7. **The engineering PR opens.** The qualified diff, technical summary, and
   verified checks become reviewable. This link from task result to PR is
   proposed orchestration; PR creation is currently a maintainer action.
8. **The PR gets its soundtrack.** A brief grounded in the reviewed PR diff
   starts a `song-lyrics` Pi Durable task. Its complete title, style, and lyrics
   are shown to the owner. Only after approval does a separate `song-render`
   task ask the host music effect for an M4A. The PR then includes the complete
   lyrics and a commit-pinned, reviewer-accessible song link alongside its
   engineering summary. These song capabilities and manual publishing steps
   exist today; automatic diff extraction, approval recording, and PR editing
   are proposed links. A lyric rejection or render failure leaves the PR in
   review without a claimed soundtrack. **H3** asks how this gate is verified.
   [Song contract](../evidence/allure/features/media-creation--create-and-review-a-song.feature),
   [manual PR guide](../wow/pull-request-soundtrack-workflow.md).
9. **A release decision is made.** A reviewer checks the AWP diff, evidence,
   PR, soundtrack, and rollback path. The cross-path release policy is proposed.
   If approved, the existing operator workflow deploys the chosen revision and
   records a pass, fail, or unjudged verification verdict. Failed or unjudged
   verification is visible and does not become an inferred pass.
   [Verification contract](../spec/ansible/verify.feature).
10. **Fresh evidence closes the walk.** Allure and the measurement oracle,
    OTel/Grafana, task results, and deployment verification form the next read
    model. A managed firing stack alert can already submit a Pi Durable
    investigation task; its bounded finding joins that evidence. A new
    improvement candidate may then be selected at step 2. The path from
    evidence to automatic change selection remains proposed.
    [Health contract](../evidence/allure/features/operations--inspect-system-health.feature),
    [alert monitor](../../products/voice-agent/tools/ops/stack_alert_monitor.py).

## Decisions exposed by the walk

| Hot Spot | Decision to test with participants | Current evidence |
| --- | --- | --- |
| H1 · Who selects a change? | Authority, threshold, deduplication, and whether a voice request and alert can converge on one candidate. | Reviewed knowledge and alert investigations exist; no single improvement selector owns both. |
| H2 · What qualifies it? | Required oracle coverage, behavior and API baselines, security checks, and handling of `unjudged`. | The measurement oracle covers the combined report adapters; network trace and spec extraction remain documented gaps. |
| H3 · PR soundtrack gate? | Capture the exact reviewed diff, record lyric approval, verify playable commit-pinned audio, and decide what happens on song failure. | The manual workflow and separate durable lyric/render tasks exist; automatic PR update does not. |

This walk is the shared process hypothesis. The [source coverage index](storming.md)
maps the 28 behavior features; the [process model](process-model.md) expands
selected decisions and refusal paths. The [C4 workspace](workspace.dsl) locates
current running responsibilities. The [event-sourcing proposal](event-sourcing-proposal.md)
is a separate software design question.
