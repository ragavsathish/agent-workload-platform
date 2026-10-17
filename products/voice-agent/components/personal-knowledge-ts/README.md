# Personal knowledge Wassette module

This module exposes one read-only personal-knowledge interface to Pi through Wassette:
`query-personal-knowledge(scope, query)`.

The interface hides identity injection, authentication, URL construction, response validation, and
gateway error handling. WAC composes a TypeScript validation module with a small Rust HTTP adapter.
The installed module receives a dedicated reader token and may contact only the loopback agent
gateway. It cannot enqueue tasks, write RDF, or execute arbitrary SPARQL.

```bash
make -C products/voice-agent/components/personal-knowledge-ts build
make -C products/voice-agent/components/personal-knowledge-ts install
```

The voice runtime starts Wassette with a mode-0600 environment file containing only the fixed
gateway URL, reader token, and owner identity needed by this component. Wassette policy grants it
access to those three values and the loopback gateway.
