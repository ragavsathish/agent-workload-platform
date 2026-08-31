# External source provenance

The platform was assembled from these repositories on 2026-08-30:

| Directory | Source | Commit | Ownership |
|---|---|---|---|
| `apps/excalidraw-mcp` | <https://github.com/excalidraw/excalidraw-mcp> | `157aa23ceb1976008aadc89eb05e3444060f09d6` | Pinned Git submodule; no platform patches |
| `adapters/mermaid-to-excalidraw` | <https://github.com/excalidraw/mermaid-to-excalidraw> | `7849b487be67cf2d439c713c847839d2494d59b6` | Pinned Git submodule; no platform patches |
| `runtimes/gondolin-browser` | <https://github.com/microsoft/playwright-mcp> | OCI `v0.0.79`, index digest `sha256:18c0a9c934004fe9580cc79f1e8e6e6cde7c667348b215335e8a23fd3e509804` | Pinned upstream browser MCP image; platform-owned Gondolin transport |
| `adapters/c4-gondolin` | Extracted from local `mermaid-to-excalidraw` commit `e7ce159` plus platform reliability changes | Continued in this monorepo | Platform-owned adapter |
| `workloads/c4-excalidraw` | Extracted from local `excalidraw-mcp` commit `d7c1664` | Continued in this monorepo | Platform-owned workload |
| `workloads/sqlite-persistence/wit/world.wit` | <https://github.com/microsoft/wassette/tree/ea9eb6403db339a8bfa6d956347007b2ab49a6f4/examples/memory-js> | `ea9eb6403db339a8bfa6d956347007b2ab49a6f4` | Unchanged upstream Memory Server contract; platform-owned SQLite implementation |
| `workloads/sqlite-persistence/.cache/sqlite-amalgamation-3530400` | <https://sqlite.org/2026/sqlite-amalgamation-3530400.zip> | SQLite 3.53.4, SHA-256 `1e71ddf93849c6a6ecf58b827c0692073d2dd7ee40196158068f7b29f422e87d` | Verified build input; downloaded, not vendored |
| `workloads/sqlite-persistence/.cache/wit-bindgen` | <https://github.com/bytecodealliance/wit-bindgen/releases/tag/v0.61.1> | v0.61.1; platform SHA-256 values pinned in `Makefile` | Verified build tool; downloaded, not vendored |

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
