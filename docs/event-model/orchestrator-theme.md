---
type: reference
title: "Self-evolving Voice Agent: one operating loop"
---

# Self-evolving Voice Agent: one operating loop

For the event-first, narrated process, start with the
[single EventStorming walk](event-storming-walk.md).

**Audience:** product maintainers and operators. **Question:** how do conversation,
durable work, the coding sandbox, knowledge, image preparation, and operational
evidence fit into one improvement cycle? The [Structurizr source](orchestrator-theme.dsl)
is the editable synthesis; its [PNG](orchestrator-theme.png) shows current links in
blue and proposed, gated links in purple. This is an operating-model view, not a
claim that autonomous code promotion exists.

The Voice Agent is the user-facing orchestrator. A spoken turn may request durable
work. The Agent Gateway authorizes it, and the Pi Durable Owner gives it one task
identity. For `agent-run` and `song-lyrics`, the owner prepares a workspace and
starts a Pi task session. Its file and shell tools use the host or a per-task
Gondolin VM according to execution mode. In VM mode, the owner resolves a default
or cached execution image; a repository cache miss invokes the separate shared
image-builder path. The owner checkpoints a bounded result, and agent work can
include a workspace artifact. The browser can follow the same task identity and
read the result.

A completed owner turn may independently start journal extraction and assertion
classification tasks. These, the daily journal, and song rendering are native
Pi Durable *tasks*, but their current effects run in bounded host child processes;
they do not enter the per-task Gondolin coding VM. The owner can review attributed
knowledge through the Gateway and knowledge graph. This is a **knowledge feedback
path**; a reviewed journal entry does not automatically rewrite prompts, code,
or deployment state.

Tests and Allure results measure observable behavior; OTel metrics and traces,
Grafana, and host measurements show runtime health. Managed stack alerts can
create Pi Durable investigation tasks. Those tasks use the same durable execution
contract, so a symptom can become a bounded investigation with a result. A test
result or alert is evidence, not by itself proof of a root cause.
The [measurement oracle](../plan/02-allure-behavior-baseline/measurement-oracle.md)
checks whether tool outputs survive adaptation into Allure faithfully; its
documented gaps still need coverage before those measurements can qualify every
product behavior. The [behavior baseline](../plan/02-allure-behavior-baseline/plan.md)
is a separate decision about the product's expected outcome.

The proposed evolution loop starts when a person or governed policy selects a
specific improvement from reviewed knowledge, task results, and measurements.
It would submit an `agent-run` change task against the **AWP repository**. Its
Pi Agent Session can use the Gondolin VM to edit the selected workspace, run
builds and checks, and produce a reviewable result. The change would then be
qualified against a behavior baseline and opened as an engineering PR. The
reviewed PR diff becomes the grounding for a separate `song-lyrics` Pi Durable
task. After the owner reviews the complete lyric manifest, a `song-render`
task produces the M4A. The PR includes the full lyrics and a reviewer-accessible,
commit-pinned link to the song alongside its technical summary and test evidence.
The reviewed PR then receives a release decision, uses the existing deployment
workflow, and is observed on the next run. The next
voice interaction and operational measurements would provide fresh evidence.
This closes the *conceptual* loop while keeping change selection, qualification,
and promotion explicit gates.

| Part of loop | Owner and existing path | Status |
| --- | --- | --- |
| Interact and delegate | Pi Voice Service → Gateway → Pi Durable Owner | Current |
| Execute Pi agent work | `agent-run` or `song-lyrics` → Pi session → host tools or task VM → bounded result and optional artifact | Current |
| Execute other product work | Journal, classification, daily journal, and song render → bounded host child effect → native task result | Current; these kinds do not use the task VM |
| Prepare VM image | Owner → Gitea workflow → shared builder → verified handoff → task VM | Current, conditional |
| Retain knowledge | Completed turn → journal and classification tasks → owner review | Current |
| Observe | Allure, OTel, Grafana, host metrics, stack alert investigations | Current; evidence surfaces have different scopes |
| Select AWP improvement | Connect a specific finding to an `agent-run` change request against the AWP repository | Proposed cross-path decision; Gondolin can execute the agent task |
| Create PR soundtrack | Reviewed AWP diff → `song-lyrics` task → owner-reviewed manifest → `song-render` host effect → lyrics and linked M4A in PR | Existing manual [PR soundtrack workflow](../wow/pull-request-soundtrack-workflow.md); automatic invocation is not implemented |
| Qualify and promote | Compare with baseline, review the AWP PR and soundtrack, approve, deploy, then observe again | Proposed closed-loop policy; existing test and deployment tools are inputs |

The [EventStorming Big Picture](big-picture.md) keeps candidate domain events and
hotspots separate from this theme. The [process model](process-model.md) names
commands and policies at the task, knowledge, and image handoffs. The
[current-state C4 workspace](workspace.dsl) locates the running containers. The
[event-sourcing proposal](event-sourcing-proposal.md) remains a separate design;
this operating loop does not require an event bus or an append-only task store.

Gondolin's [Agent Session](../../platform/agent-execution/gondolin-session/README.md)
is reusable beyond one AWP coding task: this repository also uses a persistent
voice tool VM, a shared image-builder VM, and development task VMs. Their mounts,
capabilities, credentials, and lifetimes differ. That platform capability does
not mean every Pi Durable product kind currently routes through a VM. The
[owner dispatcher](../../platform/agent-execution/pi-durable-task/owner.ts) and
[product effect](../../products/voice-agent/apps/worker/src/voice_worker/native_task.py)
define today's per-kind routing.

The [PR soundtrack guide](../wow/pull-request-soundtrack-workflow.md) is the current
human workflow. It requires a diff-grounded brief, explicit review of the lyric
manifest before rendering, an audio check, and a PR body that keeps the engineering
summary. The code does not automatically extract a PR diff, enforce a human lyric
approval, or edit the PR body. Those links remain proposed orchestration steps.

## Decisions needed before closing the loop automatically

1. What evidence and oracle qualify a proposed change, and which failures veto it?
2. Who may create an improvement task from a journal review, test regression, or
   operational alert, and how are duplicates linked to the same finding?
3. What approval and rollback rule governs code, prompt, image, and deployment
   changes? The existing alert-to-investigation path is not a promotion policy.
