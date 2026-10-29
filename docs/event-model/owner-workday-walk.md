---
type: reference
title: "Tentative EventStorming wall: the owner's day-to-day work"
---

# Tentative EventStorming wall: the owner's day-to-day work

**Question:** Where does the owner participate across ordinary work, and when does one outcome become another task? **Start:** the owner has a need, question, observation, or alert to inspect. **End:** the owner has an answer, a reviewable artifact, a recorded decision, or an explicit failure; a follow-up may begin another pass. This desk-derived extension uses the [current behavior specs](../evidence/allure/index.md) and the [one AWP change walk](event-storming-walk.md). It is a **tentative wall**, not a completed workshop or a claim that every branch is automated.

The [Structurizr source](owner-workday-walk.dsl) renders the [SVG](owner-workday-walk.svg) and [PNG](owner-workday-walk.png). The diagram is an EventStorming process view of the owner's workday, not a deployment topology. Its AWP improvement node links conceptually to the detailed change walk rather than copying every PR and deployment step here.

## One outer loop, several outcomes

🟠 **Need expressed or signal observed** → 🟠 **Voice turn completed or task requested** → 🟠 **Work accepted or request refused** → 🟠 **Answer, artifact, finding, or failure recorded** → 🟠 **Owner reviewed outcome** → 🟠 **Follow-up requested or work closed**.

The owner is present at the start and end of this loop. The middle differs by kind of work; parallel branches may finish in either order. An answer in a live conversation does **not** require a Pi Durable task. A delegated task does. The owner may also request work directly through the task contract. A public task kind is a runtime contract, not a label for every human purpose: research, planning, writing, coding, and investigation can all be instructions within `agent-run` when the workspace and tools permit them. The selected workspace can be **scratch, AWP, or another configured repository**; an AWP production change is only one possible outcome.

| Slice | Actor and command | Candidate successful events | Meaningful refusal or failure | Owner's next decision |
| --- | --- | --- | --- | --- |
| Conversation | Owner asks Pi a question or gives an instruction | Turn completed; response delivered; replay/diagnostics retained | Turn interrupted or answer unavailable | Ask a follow-up, delegate work, or end the session |
| Delegated work in any configured repository or scratch | Owner chooses a workspace and submits `agent-run` through voice, UI, or local CLI | Task accepted; selected workspace prepared; host tools or task VM started; result/artifact captured; task completed | Invalid or out-of-root workspace refused; task failed, aborted, or parked; artifact lookup failed | Inspect progress/result in the task board, review the selected repository diff when relevant, follow up in the same task session, retry, or abort |
| Personal knowledge | Completed owner turn triggers separate journal and classification tasks; owner corrects or reviews their output | Journal/classification recorded; correction or review recorded; entry projection updated | Extraction failed; assertion rejected or entry removed | Decide what personal knowledge is accepted; query the journal again |
| Daily reflection | Owner or configured workflow submits one day's messages for a `digital-twin-daily-journal` task | Daily journal task accepted; summary written through its bounded writer | Task failed or journal write unavailable | Review the daily account and correct it if needed |
| Song creation | Owner requests lyrics, reviews a complete manifest, then requests render | Lyric task accepted; manifest prepared; render task accepted; song artifact stored | Lyric task failed; lyrics rejected; render task failed | Revise the brief or lyrics, listen, or stop |
| Operations | Owner inspects dashboards or a managed alert fires | Health evidence observed; alert investigation task accepted; bounded finding captured | Missing telemetry, unjudged check, or investigation failure | Repair the service, delegate investigation, or leave an evidence-linked finding |
| Component regeneration in a selected repository | Owner nominates one component and ratifies a spec cut | Clean room verified; parallel candidates generated and judged; one selected candidate reviewed in the target repository | Fence unproved, candidate held or unjudged, stale base, or PR refused | Select one eligible candidate or fold the finding into the spec; see the [proposed regeneration walk](component-regeneration-walk.md) |
| AWP improvement | Owner or a future governed policy selects an **AWP** change from reviewed evidence | Change task accepted; result qualified; PR and soundtrack reviewed; deployment verified | Qualification held, PR review failed, or deployment verification failed | Approve, revise, roll back, or select another improvement; see the [detailed walk](event-storming-walk.md) |

## Parallel streams and boundaries

- **Task lifecycle:** one Pi Durable owner records task state and bounded progress. A task may run in host mode or in a Gondolin task VM. Its result is not the same thing as owner approval.
- **Repository boundary:** [task submission](../../products/voice-agent/packages/tasking/src/voice_agent/tasking/application/service.py) resolves a scratch workspace or an existing directory under [configured roots](../../products/voice-agent/packages/tasking/src/voice_agent/tasking/domain/workspaces.py). A Gondolin repository task may declare write access in that repository's `.pi/gondolin.json`; its declaration must [match the task workspace](../../platform/agent-execution/pi-durable-task/session-execution.ts), and the VM receives only that repository's token and route. Work on another repository is another selected workspace and identity, not an implicit side effect of the AWP change loop. A task spanning multiple repositories needs an explicit coordination rule; the current single-repository VM grant does not authorize cross-repository writes.
- **Knowledge:** journal and classification are independent durable tasks. Their attributed output requires owner review before it becomes accepted personal knowledge. A completed turn can start this branch while other delegated work continues.
- **Artifacts and media:** a workspace ZIP, lyric manifest, song, PR diff, and deployment report have different owners and review rules. A reference to one is not proof that the next is valid or available.
- **Operations:** telemetry and alerts are evidence. A selected firing alert can create an investigation task; its finding can inform a later task. An automatic AWP change selector remains proposed.
- **Cross-stream view:** the [parallel source simulation](parallel-source-simulation.md) and [LLM persona simulation](persona-simulation.md) explore a proposed read model. They do not imply one production event log for all these branches.

## Commands and decisions to preserve

| Command | Actor | State needed before deciding | Invariant / known outcome |
| --- | --- | --- | --- |
| Submit delegated task | Owner or authorized caller | Identity, selected workspace or scratch, request ID, allowed task input | Same request ID and input maps to one task; conflicting reuse is refused; an out-of-root workspace is refused. |
| Start task attempt | Task owner | Accepted task, execution mode, prepared workspace, image if needed | Host or Gondolin route preserves the public task contract; failure remains queryable. |
| Review personal knowledge | Owner | Attributed source entry and current review state | Correction/rejection is recorded; unreviewed claims are not silently accepted. |
| Render song | Owner after manifest review | Complete approved title, style, and lyrics | A failed lyric task cannot produce a render task. |
| Follow up, retry, or abort | Owner | Task identity and current state | The chosen transition is visible; completed work is not erased by a terminal abort. |
| Select AWP change | Owner or future governed policy | Reviewed evidence, measurements, findings, existing candidates | Authority and deduplication policy remain unresolved. |

**🔴 Hot spot: authority for work initiated by evidence.** The deployed alert monitor can submit a bounded investigation task; the broader move from observation to AWP change is proposed. We have not established which other day-to-day tasks may start without an explicit owner request, which effects require a separate owner decision, or how a repeated signal joins an existing task.

This wall supplies candidate user needs and acceptance slices for ordinary work, but the human boundary needs a live decision before it becomes a final process rule. The [process model](process-model.md) holds the narrower current command paths and refusal cases.
