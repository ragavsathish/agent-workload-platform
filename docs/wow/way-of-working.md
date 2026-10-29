---
type: howto
title: "Way of working"
---

# Way of working

Use this path when changing AWP behavior. It adapts Löyly's domain → slice → verification
method to this repository's existing product ownership, diagrams, and test layers.

1. **Locate the owner.** Read the relevant [wiki page](../wiki/index.md), glossary, C4 view,
   and [repository organization](../monorepo-organization.md). Keep product behavior with
   the product; move a contract to `platform/` only when it is stable and reused.
2. **State the change as an observable slice.** Record the user journey, boundaries crossed,
   expected result, and failure behavior in `docs/plan/`. Mark whether the slice describes
   existing behavior or proposes new behavior. Use Gherkin examples where they make an
   outcome precise. Link to evidence rather than inventing a new source authority.
3. **Record a decision when the contract changes.** State the options and the reason in an
   ADR under [`docs/adr/`](../adr/0001-organize-monorepo-by-product-context.md). Update the
   glossary or architecture source if the meaning or boundary changes.
4. **Implement at the owning boundary.** Follow the applicable `AGENTS.md`, product
   development guide, and dependency direction. Do not make a browser or edge process
   responsible for native owner state or host credentials.
5. **Verify at the boundary claimed.** Use the smallest test that exercises the change,
   then a deployed journey when claiming a deployed outcome. The
   [testing guide](../../products/voice-agent/TESTING.md) explains the test layers and
   commands. `make verify` checks the deployment envelope. A real voice or durable journey
   needs its own fresh result; the [Allure report](../../products/voice-agent/tests/allure/README.md)
   records the layer and evidence.
6. **Reconcile the docs.** Update the wiki, plan, diagram source, and test mapping affected
   by the change. Generated diagram PNGs follow their `.mmd` source. If evidence contradicts
   prose, correct the prose and explain the discrepancy in the change record.

The existing [voice-to-durable slice](../plan/01-voice-to-durable/plan.md) is a
**characterization baseline**. Its feature file documents current expected behavior and
points to existing tests; it is not a claim that those tests were generated from Gherkin.

## Proposed component regeneration experiment

The [component regeneration plan](../plan/03-component-regeneration/plan.md) applies
Löyly's clean-room measurement method to **one replaceable component** in a selected
repository. Its [EventStorming walk](../event-model/component-regeneration-walk.md)
records the proposed spec cut, verified fence, parallel generation, independent
qualification, one reviewed selection, and feedback into the next cut. This is an
experiment plan, not a claim that current AWP components can already be deleted and
regenerated safely. Keep the evaluator and accepted baseline outside the replaceable
unit, and retain normal PR and release review for a selected candidate.
