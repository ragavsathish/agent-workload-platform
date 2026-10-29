---
type: reference
title: "Delegated task admission: detailed decision slice"
---

# Delegated task admission: detailed decision slice

This is the admission detail behind [Phase 1 of the whole-wall expansion](expanded-storming.md). It remains a desk-derived hypothesis. Named events do not imply a production event bus.

**Boundary of this slice:** `Task requested` → `Task accepted` or `Task request refused`. Owner unavailability can leave acceptance **unconfirmed** to the caller; it must not be reported as a known refusal or success. Execution and artifacts are covered by decision point D3 on the full-wall overlay.

### Event and decision chain

| Stage | Candidate note | Meaning |
| --- | --- | --- |
| Trigger | `Task requested` | An authenticated owner or authorized local caller supplied an instruction and workspace choice. This is a request observation, not yet a persisted task. |
| Command | `Submit agent task` | The caller asks the Tasking Context to admit one bounded unit of work. |
| Read models | Workspace choice; request ledger; task snapshot | The handler needs allowed workspace identity, any prior use of the request ID, and an accepted task's public state. |
| Derivation | `Admit`, `Return existing`, or `Refuse` | A pure decision distinguishes valid input, identical replay, conflicting replay, and known invalidity; an unconfirmed owner response is a handler outcome. |
| Outcome | `Task accepted` | One durable request identity maps to a native task. This is the pivotal business event. |
| Outcome | `Task request refused` | The caller received a known refusal. Current invalid Gateway input creates no Pi Durable task. This note is an observed outcome, not necessarily a persisted domain event. |
| Outcome | `Acceptance unconfirmed` | The owner could not be queried after submission or the transport failed; reconciliation must reuse the same request identity. This is a candidate operational outcome. |

### Read models

| Read model | Fields needed for this decision | Authority / current implementation |
| --- | --- | --- |
| Request intent | Owner identity, bounded instruction, selected workspace, stable request ID | Gateway request or local CLI. The current Gateway generates a fresh UUID for each direct submission; the agreed design must carry one request ID across retries. |
| Workspace eligibility | Scratch marker or allowed published workspace / configured root, resolved workspace identity | Product configuration and [workspace validation](../../products/voice-agent/packages/tasking/src/voice_agent/tasking/domain/workspaces.py). Validation can be deferred until the worker in configured modes, so admission must state exactly which guarantee it makes. |
| Prior request use | Request ID → canonical input, task ID, creation time | Pi Durable owner's `Requests` document. It currently compares serialized input exactly. |
| Task public view | Submission identity, workspace, created time, native state | Pi Durable `describe` and `get`, projected by the Gateway into the task board. |

These are information needed for decisions or presentation, not necessarily separate database tables or CQRS projections.

### Command handler and deriver

The current command handler is split. [TaskService.submit](../../products/voice-agent/packages/tasking/src/voice_agent/tasking/application/service.py) validates the instruction and workspace, generates a UUID, calls the private owner, then describes the accepted task. [DurableTaskOwner.submit](../../platform/agent-execution/pi-durable-task/owner.ts) checks the ID and existing input, then creates the native task and records the request mapping in one owner commit. The Gateway's UUID generation means two separate `TaskService.submit` calls are two distinct requests even when their visible contents match.

**Agreed admission change:** the initiating caller supplies or retains a stable request ID for one owner intent; the Gateway forwards it on every transport retry. One ID with the same canonical intent returns the original task. A deliberate second task gets a new ID. This is a domain rule, not yet an implementation claim. The owner currently compares the entire serialized input, which can include incidental trace context. The handler must define a stable canonical comparison and keep retry-varying telemetry outside it, or identical intent could be refused as conflicting input.

A proposed pure deriver for this slice is:

```text
deriveAdmission(intent, workspaceEligibility, priorRequestUse)
  -> Refuse(reason)
   | ReturnExisting(taskId)
   | Admit(canonicalInput, requestId)
```

`Unknown` is a handler/transport result after attempted commit, not a pure domain decision. The handler must reconcile it against the owner ledger. The deriver should not open a socket, create a task, inspect a filesystem, or write a repository.

### Repository ports

`RequestLedger.find(requestId)` reads the prior request mapping. `RequestLedger.record(requestId, canonicalInput, taskId)` represents the existing owner `Requests` document and must participate in the same owner commit as native task creation. `TaskView.load(taskId)` reads the public task state. `WorkspaceEligibility.resolve(choice)` supplies a checked workspace identity; artifact storage belongs to execution. These are design names for existing responsibilities, not a request to add a second store. Atomicity and ownership rules belong to later EventStorming phases.

### Evidence and open decisions

- [Task service and workspace rules](../../products/voice-agent/packages/tasking/src/voice_agent/tasking/application/service.py), [owner request ledger and native task](../../platform/agent-execution/pi-durable-task/owner.ts), and [owner protocol](../../platform/agent-execution/pi-durable-task/README.md) establish the current behavior.
- [Durable-work scenarios](../evidence/allure/features/durable-work--continue-durable-work.feature) cover valid and invalid submission, identical replay at the owner, conflicting replay, owner unavailability, and result lookup.
- **Decision · Retry identity:** The owner chose one task for retries. The initiating caller must retain a stable request ID; Gateway and owner behavior must be brought into line with that rule.
- **H1 · Canonical intent:** Which fields define a conflicting replay? The current exact JSON comparison includes incidental metadata such as trace context.
- **H2 · Workspace promise:** Does `Task accepted` mean the workspace is already materializable, or only that its declared identity passed admission checks? Deferred validation currently permits the latter.
- **H3 · Unconfirmed commit:** What does the caller show if `submit` may have committed but `describe` is unavailable? A known refusal would be inaccurate.
