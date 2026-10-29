---
type: concept
title: "Durable work"
description: How a task persists beyond a voice session and exposes bounded results.
sources:
  - resource: ../../../products/voice-agent/docs/architecture/d2-delegated-task.mmd
    title: Delegated task journey
  - resource: ../../../products/voice-agent/GLOSSARY.md
    title: Voice Agent glossary
  - resource: ../../../products/voice-agent/TESTING.md
    title: Voice Agent testing guide
---

# Durable work

**Question:** How does requested work outlive the voice session?

An [Agent Task](../../../products/voice-agent/GLOSSARY.md) is submitted to Pi Durable and
executed separately from the active Voice Session. The Tasking Context receives completed
text, not live audio. Its Task Gateway authenticates submission and exposes owner-scoped
status, cancellation, and bounded result access. A Published Workspace is immutable task
input; a Task Artifact is immutable output.

The [D2 journey](../../../products/voice-agent/docs/architecture/d2-delegated-task.mmd)
shows two entry routes: a voice-session request through Browser → Voice Edge → Agent Gateway,
and a native CLI request through the private Unix socket. Both reach the Pi Durable Owner.
The Owner persists a native task ID and state, reopens a task conversation, executes its
tools, captures bounded results, and checkpoints the terminal result. The browser queries
the owner-scoped task view using that same task ID. Progress narration is an optional
read of bounded checkpoints.

The [C2 view](../../../products/voice-agent/docs/architecture/c2-container.mmd) separates
the Gateway from the native Owner and the workspace/result store. The
[Gateway C3 view](../../../products/voice-agent/docs/architecture/c3-agent-gateway.mmd)
locates capability authentication, owner identity policy, workspace resolution, and
public-result projection. The
[Owner C3 view](../../../products/voice-agent/docs/architecture/c3-pi-task-worker.mmd)
locates native scheduling, task conversations, execution environment selection, and result
capture. The
[deployment/security view](../../../products/voice-agent/docs/architecture/deployment-security.mmd)
shows the two tool execution branches: host tools under the worker account or a per-task
Gondolin VM. Which branch is active is deployment configuration; neither changes the
browser's task identity or public task API. Check the current deployment and run evidence
before claiming a specific isolation mode for a particular task.

The [voice-to-durable slice](../../plan/01-voice-to-durable/plan.md) records the observable
journey and links its acceptance examples to existing tests. The
[testing guide](../../../products/voice-agent/TESTING.md) separates deployment checks,
mock-backed UI checks, and a real task run. The
[Allure guide](../../../products/voice-agent/tests/allure/README.md) explains which
opt-in run creates a real scratch task and verifies its downloaded workspace ZIP.
