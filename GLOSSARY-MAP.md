# Glossary Map

This repository contains multiple product and platform contexts. Contexts gain
their own glossary when their vocabulary is actively modeled; the map expands
as the remaining repository areas migrate to bounded-context ownership.

## Contexts

- [Voice Agent](./products/voice-agent/GLOSSARY.md): turns owner speech into a
  private conversation, isolated agent actions, and durable delegated tasks.
- [Architecture Visualization](./products/architecture-visualization/GLOSSARY.md):
  turns architecture models into reviewable visual scenes and portable render
  artifacts.
- [Agent Execution](./platform/agent-execution/GLOSSARY.md): provides isolated
  agent sessions with explicit workspaces and capability surfaces.

## Relationships

- **Voice Agent → Agent Execution**: durable workers consume a Gondolin Session.
  The persistent Pi Voice Service and its voice workspace adapter remain
  product-owned.
- **Architecture Visualization → Agent Execution**: the optional browser
  fallback consumes a Gondolin Session through a product-owned integration.
- **Architecture Visualization → Vendor Sources**: rendering builds consume
  pinned, unmodified Excalidraw sources without transferring product ownership.
- **Voice Agent → Work Orchestration**: task lifecycle and artifact exchange
  are currently product-owned. They become platform contexts only after a
  second product consumes their contracts.
