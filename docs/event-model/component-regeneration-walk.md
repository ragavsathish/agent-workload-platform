---
type: reference
title: "Tentative EventStorming walk: regenerate one component"
---

# Tentative EventStorming walk: regenerate one component

**Question:** How can the owner replace one component from a durable spec while other components and repositories keep working? **Start:** an owner request or reviewed operational finding nominates one component in one repository. **End:** one qualified candidate is promoted through normal review, or the run is held with a finding that improves the spec. This is a **proposed process wall**, not an implemented event stream or a completed workshop. It is a branch of the [owner workday wall](owner-workday-walk.md), informed by [Löyly's regeneration method](../../loyly/README.md), [primary-source research](../research/phoenix-component-regeneration.md), and the [pilot plan](../plan/03-component-regeneration/plan.md).

The [Structurizr source](component-regeneration-walk.dsl) renders the [SVG](component-regeneration-walk.svg) and [PNG](component-regeneration-walk.png). Orange means candidate past-tense outcome, blue a command, lilac a policy, green a read model, and pink an unresolved decision. Every note on this board is proposed; names do not imply a production message bus.

## Narrate the wall

1. **Component nominated.** The owner or a reviewed finding identifies `(repository, component, base revision)` and a reason. The owner chooses the component boundary; an alert alone does not authorize replacement. The [pilot](../plan/03-component-regeneration/plan.md) nominates Docker archive validation, after its boundary is extracted from the mixed image archive file.
2. **Spec cut ratified.** The component owner reviews behavior, interface/schema version, invariants, capability and data ownership rules, operational limits, source provenance, and evaluation obligations. The bundle gets a digest. [Allure-extracted Gherkin](../evidence/allure/index.md) is observed evidence to reconcile, not automatic authority for the cut.
3. **Clean room verified.** The generator gets the exact cut and permitted dependencies. A fence proves the prior component source, previous candidates, and private judging inputs are unreachable. If the fence cannot be proved, the run is held before generation.
4. **Candidates generated in parallel.** One or more generation tasks start from the same cut. Each candidate carries its own ID, model/config digest, source digest, and artifact digest. Their completions may arrive in any order; candidate A never overwrites candidate B.
5. **Independent measurements recorded.** A gate outside generator control builds each candidate, tests the versioned boundary and adjacent callers, and checks functional, refusal, capability, and operational obligations. The measurement oracle qualifies the tool output. Missing checks produce `unjudged`, not a smaller denominator or pass.
6. **Candidates qualified or held.** A deterministic policy joins evidence by repository, component, spec digest, boundary version, run ID, and candidate ID. A mismatch or regression holds that candidate. Parallel arrivals can converge on the same eligible set; they do not choose a winner.
7. **One candidate selected.** The owner or authorized reviewer compares eligible candidates and records a single selected digest against the current base revision. A stale base or simultaneous conflicting selection is refused. If none qualify, the run ends held; its findings go back to spec review.
8. **Component change reviewed and promoted.** The selected candidate becomes a normal repository PR with the spec cut, gate report, provenance, and rollback path. The repo's review/release process governs promotion. AWP's [production-change walk](event-storming-walk.md) applies only when the target is AWP; another repository keeps its own release process.
9. **Operation teaches the next cut.** Telemetry, incidents, and owner review may reveal a missing obligation. A reviewed decision amends the durable spec/evaluation bundle before another regeneration. An implementation-only fix is at risk of disappearing in the next clean room.

## Decision grammar

| Command / actor | State needed | Rule | Successful event | Hold or refusal |
| --- | --- | --- | --- | --- |
| Nominate component / owner | Repository, component, reason, base revision | Target one owned boundary | `ComponentNominated` | Unknown owner or ambiguous boundary |
| Ratify spec cut / component owner | Sources, contracts, evaluation map | All required obligations have provenance and stable IDs | `SpecCutRatified` | Unreviewed or contradictory obligation |
| Verify fence / generator operator | Spec digest, allowed inputs, old implementation location | Old answer and private oracle are unreachable | `CleanRoomVerified` | `RegenerationHeld` |
| Generate candidate / agent | Verified fence and cut digest | Candidate has unique ID and cannot mutate a sibling | `CandidateGenerated` | Candidate generation failed |
| Judge candidate / independent gate | Candidate digest, same cut, oracle version | Required checks reached; vetoes pass | `CandidateQualified` | `CandidateHeld` or `CandidateUnjudged` |
| Select candidate / owner or reviewer | Complete eligible set, current base revision | One selected digest per decision version | `CandidateSelected` | Stale base or conflicting selection refused |
| Promote component / repository reviewer | PR, selected digest, rollback evidence | Normal repo review and release rules | `ComponentPromoted` | PR held or release failed |
| Revise spec / component owner | Sourced production or evaluation finding | Decide whether it is durable intent or implementation freedom | `SpecRevisionAccepted` | Finding remains open |

## Consistency and authority

The **regeneration run** is the consistency boundary for candidate identity and evidence; the **repository release** is the boundary for promotion. Per-candidate streams may be parallel and replayed out of order. A projector can derive an eligible set from immutable facts, but choosing one implementation is a separate command with a single-writer or compare-and-swap rule. No LLM persona is allowed to declare its own candidate qualified or deployed.

**🔴 H1 — Spec authority:** Which observed behaviors become durable obligations, and who can ratify changes? **🔴 H2 — Boundary:** Can the selected component be deleted while preserving a versioned interface and exclusive logical writes? **🔴 H3 — Promotion:** Who selects among eligible candidates and approves the target repository's PR? **🔴 H4 — Measurement:** Which independent holdback and operational checks are sufficient to reject a superficially green candidate?

This wall is ready to yield candidate acceptance criteria for the pilot, but these authority and boundary decisions remain open. The [existing parallel event-source simulation](parallel-source-simulation.md) covers a different synthetic AWP change; this branch's candidate race still needs its own model experiment before any convergence claim.
