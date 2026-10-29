---
type: concept
title: Behavior contracts and evidence
description: How reviewed rules, owner journeys, and observed test results support different claims.
status: stable
sources:
  - resource: ../../spec/contexts/index.md
    title: Bounded-context behavior contracts
  - resource: ../../evidence/allure/index.md
    title: Pinned Allure evidence catalog
---

# Behavior contracts and evidence

A [context spec](../../spec/contexts/index.md) states a reviewed local rule. A [slice spec](../../plan/index.md) states what an owner experiences as several contexts hand work to one another. The [Allure catalog](../../evidence/allure/index.md) records what one pinned test run observed. These are different claims: a fixture-backed pass measures its fixture boundary, while a deployed journey measures the deployed path it actually exercised.

| Claim | Read | Limit |
| --- | --- | --- |
| Intended rule | [Context specs](../../spec/contexts/index.md) | A `@proposed` scenario describes a desired rule. |
| Composed owner journey | [Slice plans](../../plan/index.md) | A mixed-status slice can include both current and proposed steps. |
| Observed result | [Allure snapshot](../../evidence/allure/index.md) | The pinned result describes its recorded run and validation layer, not every deployment. |

Stable context scenario IDs let a slice cite rules without copying them. Result IDs, validation layers, and source test names let a reviewer trace an observation back to its run. A rule marked `@proposed` remains design intent until implementation and independent verification support a current claim. See the [bounded-context map](bounded-contexts.md) for ownership and the [documentation schema](../../schema.md) for how to ingest new evidence and resolve contradictions.
