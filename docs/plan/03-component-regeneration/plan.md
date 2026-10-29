---
type: plan
title: "Component regeneration from a spec cut"
---

# Component regeneration from a spec cut

**Status:** proposed method and pilot; no AWP production component has been regenerated or replaced by this plan. **Audience:** component owner, spec reviewer, generator operator, and release reviewer. **Scope:** one replaceable component in one selected repository per run. The owner's [workday wall](../../event-model/owner-workday-walk.md) may start this work in AWP or another configured repository; the [component regeneration event walk](../../event-model/component-regeneration-walk.md) describes the proposed decisions.

## Why this grain

[Löyly](../../../loyly/README.md) treats its whole application implementation as disposable: a [proved fence](../../../loyly/harness/README.md) removes the old implementation and measurements from a clean room, a separate gate ratifies the rebuild, a checklist derived from stable spec IDs scores it, and findings return to durable docs. We retain that mechanism but shrink the deletion unit to one component. Chad Fowler's [regenerative grain](https://chadfowler.com/regenerative-software/3mfai4nqg6224/) asks whether a unit can be deleted, understood, verified at its boundary, and replaced without shared mutation. His [architecture test](https://chadfowler.com/regenerative-software/3mtmk6ot6oc2i/) asks which constraints must survive even if implementation choices change.

The durable input is a **spec bundle**, not Gherkin alone: observable behavior, interface/schema and version, invariants, authority and capability boundaries, relevant ADRs, operational limits, and provenance for each rule. The evaluator and its goldens remain outside the replaceable component. Production measurements can propose revisions to the bundle after review; they cannot silently become rules. This follows Fowler's distinction between [specification, evaluation, boundaries, and provenance](https://chadfowler.com/regenerative-software/3msssevtkqc2c/).

## Pilot: Docker archive validation

The first candidate is the image builder's **Docker archive validator**, currently `validateDockerArchive` in [`image_archive.go`](../../../platform/agent-execution/gondolin-session/image-builder/image_archive.go). It checks a tar archive's Docker manifest, requested tag, config, and referenced layers before VM handoff. [Two existing behavior scenarios](../../spec/go/image_archive.feature) cover acceptance and rejection; the [existing test](../../../platform/agent-execution/gondolin-session/image-builder/image_archive_test.go) covers a complete archive and a missing layer.

It is **not yet deletion safe**. The file also contains remote image export, the validator uses `maxJSONBytes` declared in `docker_job_api.go`, and callers in cache import and the job API use its package-private function. Before a regeneration trial, extract a boundary with a versioned contract for validation input and result, move its limits into the component contract, and keep callers behind that boundary. Preserve the exporter outside the replacement unit. Confirm the observable error categories and archive limits with the component owner; the current feature text alone does not define them fully. This extraction is ordinary reviewed implementation work, not a claim that the component has already been regenerated.

## Proposed run contract

| Item | Required identity or evidence |
| --- | --- |
| Target | Repository, component ID, boundary version, and base commit. One run may not silently change another repository or component. |
| Spec cut | Immutable digest of the behavior features, interface/schema, invariants, capability policy, ADRs, and relevant source provenance. Stable scenario IDs survive wording edits. |
| Fence | Fresh isolated checkout containing the cut and permitted dependencies; the candidate generator cannot read the old component implementation, prior candidates, private holdback inputs, or accepted goldens. Verify the fence before generation. |
| Candidate | Generated source, generator/model identity, prompt/config digest, input spec digest, and artifact digest. Several candidates may run in parallel against the same cut. |
| Ratifying gate | Build and contract checks outside generator control; component tests, caller integration, archive fixtures and adversarial cases, capability/dependency checks, and the measurement oracle. Missing measurements are `unjudged`, not passes. |
| Comparison | Stable checklist derived from spec IDs; compare each candidate to the current baseline on common items, record regressions and changed denominator separately. Runtime and security constraints are vetoes, not averaged into a score. |
| Promotion | Reviewer selects one qualified candidate or holds all. The chosen digest is pinned to the PR; no parallel candidate may independently deploy. Normal repository review and release rules still apply. |

For this pilot, the external evaluator should include complete/missing-manifest, wrong-tag, missing-config, missing-layer, malformed/oversized-manifest, and caller-level import/job-API behavior. Those are **proposed checks to specify and ratify**, not claims of present coverage. The separate remote-export behavior (`@behavior-image_archive-003`) stays outside the validator's regeneration cut.

## Parallel convergence rule

Generation may fork into multiple candidates, but each candidate's facts are keyed by `(repository, component, spec digest, run ID, candidate ID)`. A read model may ingest candidate build and measurement facts in any order and deduplicate them by event ID. It may mark a candidate *qualified* only when the complete gate for the same spec digest and boundary version is present. Promotion is a single reviewed decision against the selected base revision, with an expected version or equivalent compare-and-swap guard. Thus parallel candidate events can converge to the same **eligible set**; they do not imply automatic convergence to one chosen implementation. The decision and selected digest must be recorded explicitly.

The earlier [parallel source simulation](../../event-model/parallel-source-simulation.md) demonstrates order-independent projections for a synthetic AWP change. It does **not** test this regeneration candidate race. A later model experiment must vary candidate completion order, duplicate measurements, stale spec cuts, base-commit changes, and two simultaneous promotion attempts before claiming this policy converges.

## Acceptance for the pilot

1. The extracted component can be removed from a clean room while callers and external tests remain present; the fence proves the old implementation is absent from the generator's reachable history and workspace.
2. A fresh generator can produce a candidate from the cut without looking at the old validator; the candidate builds behind the same boundary.
3. The independent gate rejects a missing layer, wrong tag, invalid manifest, boundary version mismatch, capability expansion, and an unreached required check.
4. Two parallel candidates with identical cut identity produce separate reviewable evidence; one promotion decision selects at most one digest for a base revision.
5. A discovered behavior gap changes the spec or evaluator through reviewed provenance before another run; no important fix is kept only in disposable source.

The pilot ends at a reviewable PR and a measured regeneration report. Deployment and automatic component replacement are separate decisions. The first run should be treated as an experiment until the boundary and evaluator prove they can catch regressions the current tests miss.
