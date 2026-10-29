---
type: decision
title: "Decisions visible in slice 01"
---

# Decisions visible in slice 01

These are existing design choices documented from the product glossary, diagrams, and
tests. They do not replace accepted repository ADRs.

| Choice | Reason and source |
| --- | --- |
| Submit directly to the native Pi Durable Owner. | The [Tasking glossary](../../../products/voice-agent/GLOSSARY.md) names direct submission, and [D2](../../../products/voice-agent/docs/architecture/d2-delegated-task.mmd) shows the Gateway forwarding a task to the Owner. |
| Use the Owner's task ID across CLI, API, and Flutter. | [D2](../../../products/voice-agent/docs/architecture/d2-delegated-task.mmd) follows the native ID; the [deployed browser test](../../../products/voice-agent/tests/e2e/playwright/durable.spec.ts) checks the task card with that ID. |
| Keep the Gateway as the owner-scoped public task boundary. | The [Tasking glossary](../../../products/voice-agent/GLOSSARY.md) gives it submission, status, cancellation, and bounded result access; [C2](../../../products/voice-agent/docs/architecture/c2-container.mmd) separates it from the native Owner. |
| Treat host and Gondolin execution as deployment modes. | The [deployment/security view](../../../products/voice-agent/docs/architecture/deployment-security.mmd) shows both paths behind the same Owner. Mode-specific assurance requires the current deployment configuration and a run that exercises it. |

If one of these choices changes, update the relevant accepted ADR or add a new ADR,
then revise the diagram source, glossary, and acceptance evidence together.
