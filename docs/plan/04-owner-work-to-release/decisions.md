---
type: decision
title: "Slice 04 decisions"
---

# Slice 04 decisions

| Decision | Status | Basis |
| --- | --- | --- |
| A retry of one canonical delegated request reuses its stable request identity and returns the existing task. | Agreed; Gateway change pending. | [Task admission detail](../../event-model/delegated-task-admission.md), C2 `@bc-c2-002`. |
| Context specs own local rules; this slice owns handoffs and shared identity across them. | Adopted for documentation. | [Löyly slice](../../../loyly/docs/plan/01-booking-core/spec.feature), [context index](../../spec/contexts/index.md). |
| Measurement qualification does not choose a candidate or approve release. | Proposed rule. | C5 `@bc-c5-003`, C7 `@bc-c7-004`, [Phase 2 boundaries](../../event-model/phase-2-aggregates-contexts.md). |
| A selected candidate enters the target repository's PR and release rules; an AWP target joins AWP delivery. | Proposed cross-context handoff. | C7 `@bc-c7-004`, C9 `@bc-c9-004`, [component walk](../../event-model/component-regeneration-walk.md). |

Soundtrack exception authority, automatic change nomination, and the key for competing selections remain open in the [Phase 3 policy review](../../event-model/phase-3-policies.md).
