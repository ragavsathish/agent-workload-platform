---
type: decision
title: "0001: Organize the monorepo by product and bounded context"
---

# 0001: Organize the monorepo by product and bounded context

Status: Accepted

## Context

The repository's original `apps`, `adapters`, `components`, `runtimes`, and
`workloads` buckets mix ownership, deployment shape, and implementation
technology. The same feature is consequently spread across several top-level
directories, while terms such as workload and runtime have different meanings
in application and Kubernetes discussions. More products would multiply those
cross-directory relationships and make deletion, review, and deployment harder.

## Options Considered

| Option | Benefits | Drawbacks | Evidence or unknowns |
| --- | --- | --- | --- |
| Keep technical top-level buckets | Familiar and requires no moves | Product ownership remains distributed and dependencies are hard to see | Voice already spans workload, runtime, deployment, browser, and host code |
| Organize everything by deployable service | Clear operational units | Splits one product's language and use cases across many peers | Several current modules are shared by processes but not by products |
| Organize by product, promoting proven shared contexts | A product can be understood, tested, and removed as a vertical slice | Some duplication may remain until a second consumer proves a shared boundary | Voice and C4 already have independent users, lifecycle commands, and deployment paths |

## Decision and Rationale

We choose product-first ownership. Product-specific code remains within its
product; code moves to `platform/` only after at least two products consume a
stable contract. Immutable upstream source moves to `vendor/`, and deployment
profiles remain with the product they deploy.

| Driver | Initial reason | Evidence or constraint | Trade-off | Assessment |
| --- | --- | --- | --- | --- |
| Independent iteration | Voice and C4 should change without unrelated repository edits | They have separate commands, documentation, tests, and deployment paths | Root tooling must dispatch into products | Supported |
| Honest ownership | Directory location should answer who may change or delete code | The voice implementation was spread across `workloads` and `runtimes` | Some extraction is deferred while contracts are still product-specific | Supported |
| Reuse without premature abstraction | Shared code should have a demonstrated consumer | Current top-level buckets contain C4-only and upstream code described as shared | Temporary product-local duplication is acceptable | Supported |

## Consequences

The Voice Agent is the first migrated product. C4, Earendil, vendor sources,
and generic execution code remain operational at their current paths until
their own focused moves. Cross-product source imports are not allowed; reuse
requires a platform contract. The migration is incremental, so documentation
must distinguish current paths from target ownership until it completes.
