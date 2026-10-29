# Behavior specs by bounded context

These are the durable behavior rules behind the [one EventStorming wall](../../event-model/one-big-wall.dsl). Each context owns its terms and decisions. A slice spec under `docs/plan/` composes rules across contexts to describe an owner journey; it does not redefine their invariants. Stable `@bc-cN-NNN` IDs survive wording changes and are cited by slice scenarios.

`@current` means supported by a current product or documented manual workflow. `@agreed` records a user decision whose implementation is incomplete. `@proposed` is a design obligation and must not be reported as passing production behavior. These files are readable Gherkin contracts, not an executable suite.

| Context | Spec | Principal evidence |
| --- | --- | --- |
| C1 Voice Conversation | [spec](c1-voice-conversation/spec.feature) | [observed voice cases](../../evidence/allure/features/voice-conversation--talk-with-pi.feature), [diagnostics](../../evidence/allure/features/voice-conversation--inspect-conversation-diagnostics.feature) |
| C2 Tasking | [spec](c2-tasking/spec.feature) | [observed durable work](../../evidence/allure/features/durable-work--continue-durable-work.feature), [song work](../../evidence/allure/features/media-creation--create-and-review-a-song.feature), [task admission](../../event-model/delegated-task-admission.md) |
| C3 Personal Knowledge | [spec](c3-personal-knowledge/spec.feature) | [observed completed turn](../../evidence/allure/features/digital-twin--process-a-completed-owner-turn.feature), [knowledge review](../../evidence/allure/features/knowledge-and-review--correct-and-review-journal-knowledge.feature) |
| C4 Operational Incidents | [spec](c4-operational-incidents/spec.feature) | [alert policy](../../event-model/phase-3-policies.md), [health observation](../../evidence/allure/features/operations--inspect-system-health.feature) |
| C5 Measurement and Qualification | [spec](c5-measurement-qualification/spec.feature) | [measurement oracle](../../plan/02-allure-behavior-baseline/measurement-oracle.md) |
| C6 AWP Change Governance | [spec](c6-awp-change-governance/spec.feature) | [change walk](../../event-model/event-storming-walk.md), [policies](../../event-model/phase-3-policies.md) |
| C7 Component Regeneration | [spec](c7-component-regeneration/spec.feature) | [component plan](../../plan/03-component-regeneration/plan.md) |
| C8 Agent Execution | [spec](c8-agent-execution/spec.feature) | [host component contracts](../go/index.md), [durable work](../../evidence/allure/features/durable-work--continue-durable-work.feature) |
| C9 Repository Delivery | [spec](c9-repository-delivery/spec.feature) | [deployment contracts](../ansible/index.md), [PR soundtrack](../../wow/pull-request-soundtrack-workflow.md) |

The [owner journey slice](../../plan/04-owner-work-to-release/spec.feature) cites these IDs and describes the cross-context handoffs. The existing `features/` directory is a pinned Allure observation; `ansible/` and `go/` contain component and deployment behavior contracts. Their source-specific inventories remain intact while the context specs provide the domain split.
