---
type: decision
title: "0002: Separate Voice Agent apps from shared bounded-context packages"
---

# 0002: Separate Voice Agent apps from shared bounded-context packages

Status: Accepted

## Context

The Voice Agent server placed speech inference entrypoints, MLX adapters,
task-domain policies, FastAPI schemas, Postgres access, queue workers, and
telemetry in one directory plus a generic `orchestrator` package. Directory
names described process history rather than the product language, so a change
to transcription or durable task approval required reading unrelated modules.

## Decision and Rationale

Deployable processes live under `products/voice-agent/apps`.

- Broker-specific speech code stays with `apps/broker`.
- Gateway and worker share `packages/tasking`.
- Edge, gateway, and broker share `packages/telemetry`.
- Process entrypoints, transports, tests, and lock files stay with their apps.

## Consequences

Docker and host installers combine an app with only the packages it uses.
Shared packages do not own startup or deployment. Pipecat remains owned by
`apps/edge/`.
