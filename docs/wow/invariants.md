---
type: reference
title: "Product invariants"
---

# Product invariants

These are review questions for changes to the Voice Agent. Each points to a contract or
test surface. A future failure should be reported as a discrepancy, not hidden by prose.

| Invariant | Boundary and evidence |
| --- | --- |
| A browser request cannot directly exercise host file or model credentials. | The [C2](../../products/voice-agent/docs/architecture/c2-container.mmd) and [deployment/security](../../products/voice-agent/docs/architecture/deployment-security.mmd) views locate those capabilities behind the Voice Edge, native services, and tool boundaries. Check ingress and authorization tests in the [testing guide](../../products/voice-agent/TESTING.md). |
| Durable task identity and state belong to the Pi Durable Owner. | The [D2 journey](../../products/voice-agent/docs/architecture/d2-delegated-task.mmd) follows one native task ID through submission, state, and result. The [deployed durable browser test](../../products/voice-agent/tests/e2e/playwright/durable.spec.ts) checks the ID in the task board. |
| The task result is accessed through owner-scoped, bounded surfaces. | The [Tasking glossary](../../products/voice-agent/GLOSSARY.md) defines the Gateway, Published Workspace, and Task Artifact. The [testing guide](../../products/voice-agent/TESTING.md) lists auth and workspace-escape expectations. |
| Execution isolation mode is explicit and observable. | The [deployment/security view](../../products/voice-agent/docs/architecture/deployment-security.mmd) shows host and Gondolin branches. Current mode must be read from the deployment configuration and exercised run; the diagram alone does not prove it. |
| An automated report identifies the boundary it exercised. | The [testing guide](../../products/voice-agent/TESTING.md) separates protocol, UI, deployed, and ingress tests. The [Allure coverage audit](../../products/voice-agent/tests/allure/README.md) separates fixture, contract, and deployed evidence. |

These are documentation and review invariants. They do not add a new automated gate;
the cited tests and deployment checks are the actual enforcement surfaces.
