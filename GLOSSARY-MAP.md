# Glossary Map

This repository contains multiple product and platform contexts. Contexts gain
their own glossary when their vocabulary is actively modeled; the map expands
as the remaining repository areas migrate to bounded-context ownership.

## Contexts

- [Voice Agent](./products/voice-agent/GLOSSARY.md): turns owner speech into a
  private conversation, isolated agent actions, and durable delegated tasks.

## Relationships

- **Voice Agent → Browser and Agent Execution**: durable workers consume the
  generic Gondolin browser runtime. The persistent Pi Voice Service and its
  workspace adapter are product-owned.
- **Voice Agent → Work Orchestration**: task lifecycle and artifact exchange
  are currently product-owned. They become platform contexts only after a
  second product consumes their contracts.
