---
type: reference
title: "Proposed event sourcing for durable tasks"
---

# Proposed event sourcing for durable tasks

This is a **design**, not the deployed persistence model. The current owner keeps
native task state in SQLite. The [current-state C4 model](workspace.dsl) and
[storming board](storming.md) remain the evidence-backed description; the
[proposal workspace](event-sourcing-proposal.dsl) isolates the possible change.

## Boundary and write rule

The Pi Durable Owner remains the only task writer. A command handler checks owner
identity, task ownership, request validity, and expected stream version. It appends
one or more events to a per-task stream in SQLite in one transaction with the
idempotency record. A projector applies committed events to task status, the
bounded public progress feed, and result metadata. Reads use those projections.
No separate message broker or distributed transaction is needed for this local
single-owner design.

| Task command | Event on success | Refusal (no success event) |
| --- | --- | --- |
| Submit task | `TaskAccepted` | Invalid work, missing repository, unauthorized owner, or changed request with reused idempotency key |
| Start execution | `TaskStarted` | Task already terminal or wrong expected version |
| Publish safe progress | `PublicProgressRecorded` | Private reasoning, raw tool arguments, or output failing public projection policy |
| Finish execution | `TaskCompleted` with artifact reference and digest, or `TaskFailed` with bounded error code | Missing artifact is represented as a failed lookup, not a fabricated success |
| Abort task | `TaskAborted` | Terminal task or unauthorized owner |
| Retry task | `TaskRetryRequested` and a new attempt identity | Invalid retry state or stale version |
| Continue session | `TaskContinuationRequested` | Missing or unauthorized session |

Each event envelope would carry `eventId`, `taskId`, `streamVersion`, `eventType`,
`occurredAt`, `commandId`, `ownerId`, `attemptId`, and a versioned payload. The
`commandId` enforces replay-safe submission; a unique `(taskId, streamVersion)`
enforces order. Store references and digests for artifacts, never raw workspace
content, credentials, private model reasoning, or sensitive tool arguments.

The projector must be replayable from stream start, deterministic for a given
schema version, and idempotent by `eventId`. Snapshotting is optional after a
measured replay cost justifies it. The owner should append the terminal event
only after result artifact capture and verification; recovery must detect an
uploaded artifact without a terminal event and either complete safely or mark
the attempt failed. The event log and projections should be backed up together.

The existing Oxigraph review history already records append-only correction and
assertion decisions. It is outside this task-stream proposal; changing its writer
or folding it into the task log would be a separate design decision. Image job
status, deployment checks, and storage measurements are also outside this stream.

The design is motivated by the [durable-work](../evidence/allure/features/durable-work--continue-durable-work.feature),
[media](../evidence/allure/features/media-creation--create-and-review-a-song.feature), and
[digital-twin](../evidence/allure/features/digital-twin--process-a-completed-owner-turn.feature)
scenarios. Before implementation, an ADR should settle migration of existing
native checkpoints, retention and privacy policy, event schema compatibility,
and the exact atomicity boundary with the Pi Durable library.
