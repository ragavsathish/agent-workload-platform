---
type: reference
title: "Big Picture: what happened, and in what order?"
---

# Big Picture: what happened, and in what order?

This is a desk-derived starting board, not a facilitated workshop or a claim of
shared domain understanding. Read each lane left to right. **Orange** items are
candidate past-tense domain events. **Red** marks a candidate pivotal event that
changes what can happen next. **Pink** items are unresolved questions. Branches
show alternatives, not additional steps in the same execution.

## Lane A: conversation becomes delegated work

`VoiceTurnCompleted` → `TaskAccepted` **red** → `TaskExecutionStarted` →
`PublicProgressRecorded` (zero or more) → `ResultArtifactCaptured` **red** →
`TaskCompleted`

- Failure branch: `TaskExecutionStarted` → `TaskFailed`.
- Owner action branch: `TaskAccepted` → `TaskAborted` or
  `TaskContinuationAccepted` → a later attempt/result.
- Other entry: a direct CLI submission can start at `TaskAccepted` without a voice
  turn. The task board reads the owner projection; opening the board is not a
  domain event.
- **Pink H1:** Does a follow-up continue one task stream or create a new task linked
  to the same conversation? Verify native owner semantics before designing an
  event stream.
- **Pink H2:** At which precise point is an artifact guaranteed available relative
  to `TaskCompleted`? The current behavior requires explicit failure on a missing
  artifact.

## Lane B: completed owner turn becomes reviewed knowledge

`OwnerTurnCompleted` → (`JournalProcessingCompleted` and
`ClassificationCompleted` independently) → `JournalEntryRecorded` **red** →
`JournalCorrectionRecorded` or `AssertionReviewRecorded` → optional
`JournalEntryRemoved`

- Processing may fail independently; the failed native task remains queryable.
- Browsing, filtering, map selection, and returning to voice are reads or UI
  actions. They do not change the knowledge timeline.
- **Pink H3:** Is a correction an append-only review action plus a changed journal
  projection in one atomic update? Confirm the graph write boundary.
- **Pink H4:** Which actor can remove an entry, and what is retained in review
  history after removal?

## Bridge: accepted task becomes coding sandbox work

`TaskAccepted` → `TaskWorkspacePrepared` → **select coding tool mode**.
In Gondolin mode, **resolve execution image** → `ExecutionImageRegistered` →
`TaskVMStarted` **red** → `VMWorkspaceChanged` → `ResultArtifactCaptured`.
The owner starts a separate task VM with the working directory mounted read/write;
Pi coding tools run there for `agent-run` and `song-lyrics` tasks. The shared image-builder VM in lane C prepares an image
but never substitutes for this task VM.

- A scratch task may use the default image. A repository task can use a previously
  verified image handoff. Only a repository image cache miss enters lane C;
  `ImageHandoffPrepared` returns to `ExecutionImageRegistered` after verification
  and local registration.
- In host mode, the owner runs host coding tools against the task workspace. That
  branch yields `HostWorkspaceChanged` and then `ResultArtifactCaptured` without
  starting a task VM. Public task identity, status, and artifact shape are the
  same in both modes.
- Journal, classification, daily journal, and song-render tasks also belong to
  Pi Durable, but currently run bounded host product effects. They do not pass
  through this coding sandbox bridge.
- **Pink H8:** Which task types require a repository image rather than the default
  image, and what is the precise cache-hit validation rule?

## Lane C: a missing execution image becomes a usable handoff

`ImageBuildRequested` → `HostJobAccepted` → `BuildContextVerified` **red** →
`ImageBuilt` → `ImageArchiveValidated` → `ImageHandoffPrepared` **red** →
`ImageCacheImported`

- A cache hit bypasses the build path and uses a previously verified handoff.
- A Compose cache job can instead follow `HostJobAccepted` →
  `RegistryImagesPrepared` → `ImageHandoffPrepared` → `ImageCacheImported`.
- Invalid request, conflicting run ID, unverified context, missing blob, or bad
  checksum stops the flow before its corresponding success event.
- **Pink H5:** Host job status is in memory while handoff files survive a process
  restart. What recovery and idempotency guarantee is required?
- **Pink H6:** Who owns the decision that a build service's image identifier is
  verified before it enters the shared cache?

## Lane D: the stack becomes ready and evidence is collected

`HostPrerequisitesConfirmed` → `NativeServicesInstalled` →
`DeploymentConverged` **red** → `InfrastructureVerificationPassed` or
`InfrastructureVerificationFailed`

- A synthetic voice probe, browser journey, RDF check, benchmark, and storage
  sample produce **evidence**, not new domain entities. They are kept alongside
  the verification verdict or in telemetry and test reports.
- If ingress cannot be judged, the result is `InfrastructureVerificationUnjudged`,
  not a pass.
- **Pink H7:** Which verification verdict must be retained across deployments,
  and for how long? Current reports and metrics do not form one canonical run log.

## Candidate seams

The lanes expose four distinct ownership areas: conversation, durable work,
knowledge review, and image preparation. The bridge connects durable work to its
coding runtime. Deployment verification is an operator
process across them. These are **candidate bounded-context seams**, not a redesign
of the existing C4 containers. The [process board](process-model.md) tests commands,
policies, and read models at the handoffs; the [Structurizr model](workspace.dsl)
shows where the current responsibilities run.
