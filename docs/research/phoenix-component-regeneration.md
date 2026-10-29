---
type: reference
title: "Phoenix architecture and component regeneration in AWP"
---

# Phoenix architecture and component regeneration in AWP

**Status:** research and proposal, not a description of an implemented AWP regeneration pipeline. **Names:** Chad **Fowler** writes *The Phoenix Architecture*; Chris **Ford** discusses it in the JUXTCast episode already analyzed in [Löyly](../../loyly/docs/juxtcast-agentic-engineering-at-scale.md#the-fence-versus-phoenix-architecture-partial-and-worth-being-careful-about). They are different people and Ford's cautious endorsement is not Fowler's design claim.

## What the primary sources say

- Fowler defines a **regenerative grain** as the unit whose implementation can be deleted and rebuilt while behavior is checked at its boundary. His diagnostic asks whether the unit owns its logical mutations, has a versioned contract, and can be verified without booting half the system. He explicitly applies the deletion test to *components, services, and modules*, not only whole applications. [Fowler, *The Regenerative Grain*](https://chadfowler.com/regenerative-software/3mfai4nqg6224/)
- The durable artifacts are **specification, evaluation, context boundary, and provenance**. Generated files and their internal layout may change; cross-component API/event schemas and ownership rules form the conserved boundary. [Fowler, *The Phoenix Primitives*](https://chadfowler.com/regenerative-software/3mjfruwwuck2d/)
- The compilation target is an architecture that constrains communication, mutation authority, component grain, and evaluation surfaces. This makes a component replaceable within a continuing system. [Fowler, *Compile to Architecture*](https://chadfowler.com/regenerative-software/3mgfsrk75ac2l/)
- Production measurements can invalidate a requirement's evidence and its affected implementation subgraph, triggering bounded regeneration. This is an architectural proposal in Fowler's article, not evidence that AWP already does it. [Fowler, *Production Is a Compiler Input*](https://chadfowler.com/regenerative-software/3mjx4erlboc2l/)
- Fowler later cautions that a spec can contain prose, schemas, executable evaluations, and production evidence, and says he has not seen a substantial production system reliably regenerate arbitrary pieces without meaningful loss. [Fowler, *When Does a Specification Become a Program?*](https://chadfowler.com/regenerative-software/3msssevtkqc2c/)

## What Löyly demonstrates today

Löyly's [read order and loop](../../loyly/README.md) make raw sources, a domain wiki, a Gherkin slice, recorded decisions, and an independent harness durable. Its [fence](../../loyly/harness/fence.sh) removes `impl/` and measurement artifacts, including their Git history in the clean room, then proves the agent cannot read the previous answer. The [harness](../../loyly/harness/README.md) derives a checklist from the frozen spec, ratifies the rebuilt application, and compares cycles. This is an **application-sized regeneration experiment**: the deliberate delta measures what the spec failed to preserve. Löyly's [way of working](../../loyly/docs/wow/way-of-working.md#5-regeneration-as-a-validation-instrument) says so explicitly; its `impl/` is currently [intentionally empty](../../loyly/impl/README.md).

Löyly therefore supplies a strong **custody and measurement method**, but does not yet demonstrate independently regenerated production components behind durable interfaces. Its own [Ford comparison](../../loyly/docs/juxtcast-agentic-engineering-at-scale.md#5-phoenix-architecture-he-is-sceptical-we-do-it-and-our-own-instrument-says-he-is-right-to-be) records the risk: implementation-only learning may be lost in a later whole-app regeneration. The resulting lesson is to promote an observed constraint into the durable knowledge and evaluation layer before deleting the code that taught it.

## Component-level amendment for AWP (proposal)

Use **one bounded context component at a time** as the regeneration unit. A first candidate should own a narrow decision and state transition, expose an explicit versioned API or event contract, and permit independent black-box checks. Existing [AWP Gherkin extracted from Allure](../evidence/allure/index.md) is observed test behavior, not automatically authoritative product intent; it must be reconciled with the domain owner and executable boundary checks before it can govern regeneration. The [tentative owner workday wall](../event-model/owner-workday-walk.md) identifies several work types and repository targets; it is not itself a component contract.

For each candidate grain, retain a compact **regeneration packet** outside its implementation:

1. **Intent and authority:** domain facts, source links, invariants, decision log, and the owner who may change them.
2. **Boundary:** versioned commands, responses/events, data ownership, compatibility rules, and forbidden cross-component writes.
3. **Evaluation:** independent contract, property, replay, failure, and operational checks with a frozen comparison baseline.
4. **Provenance:** spec/evaluation versions, input evidence, generator and model identity, resulting artifact digest, and the reason for regeneration.

Then run one controlled deletion experiment: build the candidate in isolation from that packet, compare it with the current component under the same contract/evidence set, exercise compatibility with neighboring components, and record discrepancies as either missing durable knowledge or legitimate implementation freedom. Promote discovered invariants and counterexamples into the packet, then repeat. The prior implementation must remain available for rollback in production while the clean-room builder cannot use it as an answer. Production telemetry may nominate a stale claim, but the step from signal to revised requirement remains an explicit governed decision.

**Acceptance condition for the idea:** two independently generated implementations can replace the candidate behind the same versioned boundary; each passes the independent evaluation suite; neighboring components and persistent data remain compatible; the provenance chain explains every regeneration. Until this is shown on one AWP component, “regenerable” describes a target, not a property of the stack.
