# External source provenance

The platform was assembled from these repositories on 2026-08-30:

| Directory | Source | Commit | Ownership |
|---|---|---|---|
| `vendor/excalidraw-mcp` | <https://github.com/excalidraw/excalidraw-mcp> | `157aa23ceb1976008aadc89eb05e3444060f09d6` | Pinned Git submodule; no platform patches |
| `vendor/mermaid-to-excalidraw` | <https://github.com/excalidraw/mermaid-to-excalidraw> | `7849b487be67cf2d439c713c847839d2494d59b6` | Pinned Git submodule; no platform patches |
| `platform/agent-execution/gondolin-session` | <https://github.com/microsoft/playwright-mcp> | OCI `v0.0.79`, index digest `sha256:18c0a9c934004fe9580cc79f1e8e6e6cde7c667348b215335e8a23fd3e509804` | Pinned upstream browser MCP image; platform-owned Agent Session transport |
| Runtime-loaded Memory tools | <https://github.com/modelcontextprotocol/servers/tree/main/src/memory> | npm `@modelcontextprotocol/server-memory@2026.8.31` | Unmodified maintained MCP server; persistent JSONL path configured by the platform |
| Runtime-loaded GitHub tools | <https://github.com/microsoft/wassette/tree/main/examples/github-js> | OCI manifest `ghcr.io/microsoft/github-js@sha256:a0372191a39281755fe7e10d6afff8733e1af65f6af2e5c21d923ca82f0a53fb` | Unmodified published component; dynamically discovered schemas; capability-limited by Wassette |
| `products/architecture-visualization/integrations/gondolin` | Extracted from local `mermaid-to-excalidraw` commit `e7ce159` plus product reliability changes | Continued in this monorepo | Architecture Visualization integration |
| `products/architecture-visualization` | Extracted from local `excalidraw-mcp` commit `d7c1664` | Continued in this monorepo | Architecture Visualization product |

## Dependency policy

Use a submodule when the dependency can remain unchanged and its pinned commit
is fetchable from the URL recorded in `.gitmodules`. This keeps upstream history
without mixing its files into platform commits.

Keep code vendored when the platform owns unpublished changes or must make
cross-module edits atomically. Convert it to a submodule only after those
changes live on a stable public fork or have been accepted upstream.

Submodules prevent file-level merge conflicts with upstream source. They can
still produce a gitlink conflict if two platform branches independently update
the same pin, so one change should own each pin update.
