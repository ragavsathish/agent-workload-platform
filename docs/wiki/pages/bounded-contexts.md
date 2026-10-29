---
type: concept
title: Bounded contexts
description: Candidate decision boundaries and their owning behavior contracts.
status: stable
sources:
  - resource: ../../event-model/phase-2-aggregates-contexts.md
    title: Phase 2 aggregates and context map
  - resource: ../../spec/contexts/index.md
    title: Bounded-context Gherkin index
---

# Bounded contexts

The [one EventStorming wall](../../event-model/one-big-wall.dsl) names nine candidate language and decision boundaries. A bounded context owns the meaning of its rules; it does not necessarily correspond to one process or repository. The [Phase 2 map](../../event-model/phase-2-aggregates-contexts.md) gives each boundary's authority and current or proposed status. This page catalogs the model; its `stable` document status does not promote a proposed context to implemented behavior.

| Context | Owns | Behavior contract |
| --- | --- | --- |
| C1 Voice Conversation | Session, turn, answer, interruption | [C1](../../spec/contexts/c1-voice-conversation/spec.feature) |
| C2 Tasking | Request admission, task result, song generation | [C2](../../spec/contexts/c2-tasking/spec.feature) |
| C3 Personal Knowledge | Suggestions, review history, daily account | [C3](../../spec/contexts/c3-personal-knowledge/spec.feature) |
| C4 Operational Incidents | Managed alert and incident epoch | [C4](../../spec/contexts/c4-operational-incidents/spec.feature) |
| C5 Measurement and Qualification | Attributable measurement and verdict | [C5](../../spec/contexts/c5-measurement-qualification/spec.feature) |
| C6 AWP Change Governance | Evidence-linked improvement case | [C6](../../spec/contexts/c6-awp-change-governance/spec.feature) |
| C7 Component Regeneration | Spec cut, run, candidates, selection | [C7](../../spec/contexts/c7-component-regeneration/spec.feature) |
| C8 Agent Execution | Session, workspace mount, capability grant | [C8](../../spec/contexts/c8-agent-execution/spec.feature) |
| C9 Repository Delivery | PR review and release verification | [C9](../../spec/contexts/c9-repository-delivery/spec.feature) |

The [owner journey slice](../../plan/04-owner-work-to-release/spec.feature) passes identities and outcomes across these boundaries. C5–C7 describe mostly proposed cross-path rules; the [behavior and evidence page](behavior-and-evidence.md) explains why a proposed rule cannot be promoted by an observed test alone.
