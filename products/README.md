# Products

Each product is a complete user-facing vertical slice. It owns the applications,
services, workers, contracts, deployment profiles, tests, documentation, and
vocabulary required to deliver its outcome.

- [`voice-agent`](voice-agent/README.md) provides a private browser voice
  interface with local Apple-accelerated inference and isolated Pi actions.

Product code must not import another product's internals. Promote code into a
platform bounded context only after a stable contract has at least two real
product consumers.
