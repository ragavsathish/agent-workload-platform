# Journal & Knowledge web experience

Standalone React page for browsing the personal digital-twin journal with the shared Pi design
system. It provides a searchable journal list, topic filters, source-capture details, and a lazy
Cytoscape relationship map with linked selection. The selected-note pane includes a review UX
surface: correct note text/type/tags, remove a note from the visible map, and record an
owner-assertion review after checking authorship. With live Oxigraph data, note edits and removals
are saved through the owner-authenticated edge and gateway journal feedback route. Assertion reviews
are appended to a separate review graph; they are not accepted personal facts or training labels.
With sample data, review controls remain in-memory previews with Undo and reset on reload.

The note card and Cytoscape graph are React modules in `apps/client/knowledge_ui`. The knowledge
page and Journal Review MCP App import the same modules. Each host supplies its journal data and
selection actions; the shared graph owns layout, rendering, controls, and cleanup.

Without an endpoint configured, the page shows illustrative sample entries. The deployment builds
the app with `VITE_OXIGRAPH_QUERY_URL=/oxigraph/query`; Tailscale ingress maps that same-origin path
to Oxigraph's read-only `/query` endpoint. The browser instantiates a small Rust WebAssembly module
directly; that module contains the fixed SPARQL query, decoder, and bounded review-command encoders.
Browser `fetch` provides network access. The Wassette component uses the same Rust crate for its
query and decoder. Writes use same-origin `/api/knowledge/journal/{id}/...` routes, where the edge
validates the owner and supplies gateway credentials. No Oxigraph credential is embedded in the app.

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
