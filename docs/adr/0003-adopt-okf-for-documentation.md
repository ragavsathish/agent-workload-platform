---
type: decision
title: Adopt OKF for the documentation bundle
description: Use a typed Markdown knowledge bundle with curated wiki synthesis and separate evidence.
status: stable
decision_state: accepted
sources:
  - resource: https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md
    title: Open Knowledge Format v0.2 specification
  - resource: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
    title: LLM Wiki idea
---

# ADR 0003: Adopt OKF for project documentation

## Decision

Use `docs/` as an Open Knowledge Format v0.2 bundle. Every Markdown concept document has YAML frontmatter with a non-empty `type`; each area has an `index.md` catalog. `docs/log.md` records significant knowledge maintenance. Gherkin, Structurizr DSL, images, JSON, and executable scripts remain linked assets with their own native formats.

Organize the bundle as source evidence → maintained wiki → curated context rules → journey slices and decision records. The [schema](../schema.md) specifies ingest, query, and lint operations. This instantiates [Karpathy's LLM Wiki idea](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) for this project while keeping the existing [Löyly-inspired slice pattern](../plan/index.md).

## Consequences

The [Allure snapshot](../evidence/allure/index.md) is generated evidence, separate from [curated specs](../spec/index.md). The [wiki](../wiki/index.md) updates existing concept pages when new evidence changes an understanding and links claims to their sources. Proposed behavior stays visibly proposed until implementation and fresh verification support a stronger claim. The [root index](../index.md) is the entry point.

## Sources

- [OKF v0.2 specification](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md) defines the Markdown frontmatter, provenance, lifecycle, and index conventions. The [annotated guide](https://okf.md/spec/) includes older v0.1 examples; the canonical v0.2 specification governs this bundle.
- [Karpathy's LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) describes raw sources, maintained synthesis, schema, index, log, and maintenance operations.
