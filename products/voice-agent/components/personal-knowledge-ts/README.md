# Personal knowledge Wassette module

This module exposes one read-only personal-knowledge interface to Pi through Wassette:
`query-personal-knowledge(scope, query)` and `query-journal()`.

The interface hides identity injection, authentication, URL construction, response validation, and
gateway error handling. WAC composes a TypeScript validation module with a small Rust HTTP adapter.
The installed module receives a dedicated reader token for the gateway operation and can reach only
the loopback agent gateway and loopback Oxigraph endpoint. It cannot enqueue tasks or write RDF.

The journal query and SPARQL JSON decoder are also exported as WebAssembly functions. The knowledge
page loads that same component through JCO's browser bindings, asks it for the fixed query, uses the
browser's `fetch` capability to POST to the same-origin `/oxigraph/query` ingress, then passes the
response back to the component for decoding. Wassette uses the same query and decoder through its
host HTTP adapter. The browser never receives an Oxigraph credential.

```bash
make -C products/voice-agent/components/personal-knowledge-ts build
make -C products/voice-agent/components/personal-knowledge-ts install
```

The voice runtime starts Wassette with a mode-0600 environment file containing only the fixed
gateway URL, reader token, and owner identity needed by this component. Wassette policy grants it
access to those three values and the loopback gateway.
