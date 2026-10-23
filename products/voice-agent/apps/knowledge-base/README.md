# Journal & Knowledge web experience

Standalone React page for browsing the personal digital-twin journal with the shared Pi design
system. It provides a searchable journal list, topic filters, source-capture details, and a lazy
Cytoscape relationship map with linked selection.

Without an endpoint configured, the page shows illustrative sample entries. The deployment builds
the app with `VITE_OXIGRAPH_QUERY_URL=/oxigraph/query`; Tailscale ingress maps that same-origin path
to Oxigraph's read-only `/query` endpoint. The browser instantiates a small Rust WebAssembly module
directly; that module contains the fixed SPARQL query and decoder. Browser `fetch` provides network
access. The Wassette component uses the same Rust crate for its query and decoder.
No Oxigraph credential is embedded in the app, and same-origin requests need no CORS exception.

Run the page locally:

```bash
npm ci
npm run dev -- --host 127.0.0.1
```

Build the production bundle with `npm run build`. The voice edge serves the generated bundle at
`/knowledge/` after rebuilding its image.

For a direct local build against a reachable endpoint:

```bash
VITE_OXIGRAPH_QUERY_URL=https://oxigraph.example.ts.net/oxigraph/query npm run build
```
