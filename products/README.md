# Products

Each product is a complete user-facing vertical slice. It owns the applications,
services, workers, contracts, deployment profiles, tests, documentation, and
vocabulary required to deliver its outcome.

- [`voice-agent`](voice-agent/README.md) provides a private browser voice
  interface with local Apple-accelerated inference and isolated Pi actions.
- [`architecture-visualization`](architecture-visualization/README.md) turns C4
  source into policy-checked Excalidraw scenes and render artifacts.

Product code must not import another product's internals. Promote code into a
platform bounded context only after a stable contract has at least two real
product consumers.
