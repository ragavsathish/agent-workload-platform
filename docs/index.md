# Agent Workload Platform documentation

This is the OKF v0.2 entry point for the project's domain, architecture, delivery, and
verification knowledge. Read the [maintenance schema](schema.md) for how sources become
wiki synthesis, behavior contracts, and journey slices; [ADR 0003](adr/0003-adopt-okf-for-documentation.md)
records the format choice. The [knowledge log](log.md) records significant updates.

## Read in order

1. [Domain wiki](wiki/index.md) — maintained product concepts, boundaries, and links to evidence
   behind each description.
2. [Architecture views](../products/voice-agent/docs/architecture/README.md) — C1 system
   context, C2 containers, C3 components, dynamic journeys, and deployment/security view.
   The `.mmd` files are the editable diagram sources.
3. [Way of working](wow/way-of-working.md) and [invariants](wow/invariants.md) — how to
   make and verify changes without losing the product's boundaries.
4. [Voice to durable work slice](plan/01-voice-to-durable/plan.md) — a documented baseline
   journey, its Gherkin examples, decisions, and existing test evidence.
5. [Bounded-context specs](spec/contexts/index.md) — durable Gherkin rules for C1–C9;
   the [owner journey slice](plan/04-owner-work-to-release/plan.md) composes those rules
   across contexts without copying their invariants.
6. [Allure evidence](evidence/index.md) — exact observed Given/When/Then steps from a
   pinned combined run, with each scenario's validation layer and result ID.
7. [Behavior baseline plan](plan/02-allure-behavior-baseline/plan.md) — reviewed golden
   predicates and a comparison gate for selected deployed journeys, preceded by a
   [measurement oracle](plan/02-allure-behavior-baseline/measurement-oracle.md) for the
   tool adapters and accompanied by an [API shape baseline](plan/02-allure-behavior-baseline/api-shape.md).
8. [Measurement harness spec](../harness/spec.feature) — the contract for the tools that
   turn test output into Allure measurements and coverage claims.
9. [Automation contract](spec/ansible/index.md) — language-neutral Gherkin for all
   current Voice Agent Ansible playbooks and their supporting roles.
10. [Go component contracts](spec/go/index.md) — language-neutral Gherkin for every
   production Go source file in the host image builder and storage collector.
11. [Event models](event-model/index.md), starting with the
    [one big EventStorming wall](event-model/one-big-wall.md) — the owner process
    from ordinary work through review, AWP change, or component regeneration.
    The [workday detail](event-model/owner-workday-walk.md) covers conversation,
    delegated work, knowledge review, songs, operations, and follow-up. Its
    [AWP improvement branch](event-model/event-storming-walk.md) continues through
    task execution, PR soundtrack, release, and the next observation;
    the proposed [component regeneration branch](event-model/component-regeneration-walk.md)
    applies to one component in a selected repository;
    [C4 and source index](event-model/index.md).

Browse by area: [wiki](wiki/index.md) · [architecture image archive](architecture/index.md) · [specs](spec/index.md) ·
[plans](plan/index.md) · [evidence](evidence/index.md) ·
[event models](event-model/index.md) · [ways of working](wow/index.md) ·
[research](research/index.md) · [decisions](adr/index.md).

## Existing reference material

| Question | Read |
| --- | --- |
| What does the product do and how is it operated? | [Voice Agent README](../products/voice-agent/README.md), [host requirements](../products/voice-agent/HOST_REQUIREMENTS.md) |
| What do product and platform terms mean? | [Voice Agent glossary](../products/voice-agent/GLOSSARY.md), [Agent Execution glossary](../platform/agent-execution/GLOSSARY.md), [glossary map](../GLOSSARY-MAP.md) |
| Why are the repository and service boundaries drawn this way? | [ADR 0001](adr/0001-organize-monorepo-by-product-context.md), [ADR 0002](adr/0002-layer-the-voice-server-by-bounded-context.md), [repository organization](monorepo-organization.md) |
| Which tests prove a behavior? | [Testing guide](../products/voice-agent/TESTING.md), [Allure guide](../products/voice-agent/tests/allure/README.md) |
| How are imported sources tracked? | [Provenance](../PROVENANCE.md) |

## Evidence and status

The wiki synthesizes product concepts and cites its sources; its document lifecycle status
does not certify implementation or verification. A plan's status says whether it records
existing behavior or proposes a change. Gherkin examples in this directory are readable
acceptance descriptions; they are **not** automatically executed by a feature runner.
For an actual verification claim, use the linked test and a fresh run result. A passing
deployment check is evidence for the deployment envelope, not a substitute for the
user journey.

When prose and implementation disagree, inspect the relevant diagram source, code,
configuration, and test output, then update the inaccurate document. Record a design
decision in an ADR when the boundary or contract changes.
