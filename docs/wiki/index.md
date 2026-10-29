# Domain wiki

The wiki gives readers a short route from a product term to its architecture and evidence.
It is maintained synthesis over the sources cataloged by the [docs schema](../schema.md);
the linked glossaries define product terms. New evidence updates these pages and their
cross-links before it produces another summary of the same concept.
Source lists in concept frontmatter identify the material behind each synthesis. A page's
OKF lifecycle status describes the page, while the linked model, spec, and test result
establish whether a behavior is proposed, current, or observed.

| Page | Main question |
| --- | --- |
| [Interactive voice](pages/interactive-voice.md) | How does one spoken turn reach Pi and return to the browser? |
| [Durable work](pages/durable-work.md) | How does a request become a persistent task with a bounded result? |
| [Bounded contexts](pages/bounded-contexts.md) | Which context owns a rule and what crosses its boundary? |
| [Behavior and evidence](pages/behavior-and-evidence.md) | How do curated rules, journey slices, and test measurements relate? |

## Boundaries

AWP is the private runtime. [Voice Agent](../../products/voice-agent/README.md) is its first
product. Voice Agent owns the **Conversation** and **Tasking** contexts. The reusable
[Agent Execution](../../platform/agent-execution/GLOSSARY.md) context owns agent sessions,
workspace mounts, and capability surfaces. The [glossary map](../../GLOSSARY-MAP.md) and
[ADR 0001](../adr/0001-organize-monorepo-by-product-context.md) explain why tasking remains
inside the product until another consumer needs a stable shared contract.

The [C1 context](../../products/voice-agent/docs/architecture/c1-system-context.mmd)
sets the system boundary. The [C2 container view](../../products/voice-agent/docs/architecture/c2-container.mmd)
names the running applications and data stores. The
[deployment/security view](../../products/voice-agent/docs/architecture/deployment-security.mmd)
shows where those parts run and where trust changes.

## Reading claims

- **Term**: use the [Voice Agent glossary](../../products/voice-agent/GLOSSARY.md) or
  [Agent Execution glossary](../../platform/agent-execution/GLOSSARY.md).
- **Design intent**: use an accepted [ADR](../adr/0001-organize-monorepo-by-product-context.md)
  and the architecture source diagrams.
- **Current behavior**: inspect code, deployment configuration, and the linked tests. A diagram
  can lag a changed deployment.
- **Verified behavior**: use the test layer and fresh run evidence described in the
  [testing guide](../../products/voice-agent/TESTING.md) and
  [Allure guide](../../products/voice-agent/tests/allure/README.md).
