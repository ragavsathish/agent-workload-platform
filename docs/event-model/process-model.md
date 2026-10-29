---
type: reference
title: "Process modelling: commands, policies, and read models"
---

# Process modelling: commands, policies, and read models

This narrows the Big Picture to three paths where decisions cross an ownership
boundary. Legend: **blue** command/intention, **orange** resulting event, **lilac**
policy, **green** read model, **pink** unresolved hotspot. These are textual
equivalents of notes, not a claim that named events are published messages.

## Delegated task, including refusal

| Step | Blue command / actor | Lilac policy or decision | Orange outcome | Green read model / owner |
| --- | --- | --- | --- | --- |
| 1 | Owner requests work through voice or CLI | Authenticate owner; validate request and repository; apply idempotency | `TaskAccepted`, or request refused | Gateway public task view; Pi Durable Owner task state |
| 2 | Owner prepares the working directory | Materialize the accepted task's workspace before coding tools run | `TaskWorkspacePrepared` | Task workspace on host filesystem |
| 3 | Owner starts the accepted attempt | Select host or Gondolin mode without changing public task shape; in Gondolin mode resolve the default image or a verified repository image | `ExecutionImageRegistered` when applicable, then `TaskVMStarted` in Gondolin mode; host mode starts host tools | Native task status and image handoff |
| 4 | Pi coding tools run | VM tools write to the mounted `/workspace` in Gondolin mode; host tools write to the task workspace in host mode | `VMWorkspaceChanged` or `HostWorkspaceChanged`; `TaskExecutionStarted` and bounded progress | Task workspace and owner progress projection |
| 5 | Task session reports safe progress | Include only bounded tool events and explicitly public `Progress:` text | `PublicProgressRecorded` | Owner progress projection, consumed by browser/narrator |
| 6 | Task runner captures result | Verify artifact presence and ownership before exposing reference | `ResultArtifactCaptured` | Result store and owner metadata |
| 7 | Owner completes or fails the attempt | Terminal result must match captured artifact or explicit failure | `TaskCompleted` or `TaskFailed` | Task board and result lookup |
| 8 | Owner follows up, aborts, or retries | Task ownership and current state govern permitted transition | `TaskContinuationAccepted`, `TaskAborted`, or retry accepted | Same owner task/session view |

**Pink:** The exact atomicity between artifact capture, native checkpoint, and
terminal result needs confirmation. A proposed append-only task stream is explored
separately in the [event-sourcing design](event-sourcing-proposal.md); this current
process does not assume that design is deployed.

## Knowledge correction and review

Completed-turn journal and classification tasks take a separate current path:
the Gateway submits each to Pi Durable, whose owner checkpoints each task and
runs its bounded host product effect. They do not use the task VM shown in the
delegated agent-task path above.

| Step | Blue command / actor | Lilac policy or decision | Orange outcome | Green read model / owner |
| --- | --- | --- | --- | --- |
| 1 | Owner asks to correct or review an entry | Gateway requires owner identity and a bounded target/action | Accepted command or refusal | Entry details shown in knowledge UI |
| 2 | Gateway writes review action | Retain previous decision history; apply correction/removal semantics | `JournalCorrectionRecorded`, `AssertionReviewRecorded`, or `JournalEntryRemoved` | Oxigraph feedback graph and current entry projection |
| 3 | Owner queries the entry again | Query is read-only and bounded | No new domain event | Browser journal, graph, and selected details |

**Pink:** Confirm whether the review history and current entry projection update
atomically for every correction/removal path.

## Image preparation and cache import

| Step | Blue command / actor | Lilac policy or decision | Orange outcome | Green read model / owner |
| --- | --- | --- | --- | --- |
| 1 | Workflow requests an image job | Authenticate token; validate revision, architecture, run ID, and source-derived version | `HostJobAccepted`, or refusal/conflict | Host job status (in memory) |
| 2 | Workflow uploads build context | Verify declared byte count and SHA-256 before queueing | `BuildContextVerified`, or refused upload | Job status and verified context metadata |
| 3 | Host builds, pulls, and exports | Only verified host-built identifiers join Compose cache; reject incomplete archive | `ImageBuilt` and `ImageArchiveValidated`, or job failure | Docker Engine and handoff files |
| 4 | Importer promotes handoff | Verify index, tag, checksum, manifest, and referenced blobs | `ImageCacheImported`, or refused import | Shared image store and preload metadata |
| 5 | Task owner loads image | Use a matching previously verified handoff on cache hit; on a miss, verify the new handoff and register the image locally | `ExecutionImageRegistered` | Task coding sandbox image selection |
| 6 | Task owner starts sandbox | Mount the prepared workspace read/write into the separate task VM | `TaskVMStarted` | Pi coding tools in the task VM |

**Pink:** The job status store is not durable. Decide whether a restart should
resume, reconstruct, or explicitly fail an accepted job before implementing an
event log or queue.

## AWP change PR and soundtrack

This is the [current manual PR soundtrack workflow](../wow/pull-request-soundtrack-workflow.md)
connected to the proposed AWP improvement loop. Song generation is durable;
automatic diff extraction and PR editing are not implemented.

| Step | Command / actor | Policy or decision | Outcome and read model |
| --- | --- | --- | --- |
| 1 | Maintainer opens an AWP PR from a reviewed diff | Keep an engineering summary and verified checks in the PR | Reviewable PR and exact diff |
| 2 | Owner submits a lyric brief grounded in that diff | Exclude credentials, private transcripts, identities, and unreviewed personal data | `song-lyrics` Pi Durable task; reviewable title, style, and lyric manifest |
| 3 | Owner reviews the complete manifest and requests render | Explicit approval in a later turn; a changed lyric version needs renewed review | Separate `song-render` Pi Durable task |
| 4 | Product effect renders and stores the song | ACE-Step health and bounded artifact checks; listen to the delivered M4A | Owner-checked audio path and reviewed M4A |
| 5 | Maintainer updates the PR | Include full lyrics, commit-pinned reviewer-accessible song link, and unchanged technical summary | PR carries both engineering evidence and soundtrack |
| 6 | Reviewer decides whether to release | Qualification and release policy remain a proposed cross-path gate | AWP change is approved or held; deployment follows separately |
