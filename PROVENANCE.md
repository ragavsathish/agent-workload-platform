# External source provenance

The platform was assembled from these repositories on 2026-08-30:

| Directory | Source | Commit | Ownership |
|---|---|---|---|
| `apps/excalidraw-mcp` | <https://github.com/excalidraw/excalidraw-mcp> | `157aa23ceb1976008aadc89eb05e3444060f09d6` | Pinned Git submodule; no platform patches |
| `adapters/mermaid-to-excalidraw` | <https://github.com/excalidraw/mermaid-to-excalidraw> plus local implementation | `e7ce159` source snapshot, followed by platform reliability changes | Vendored because the C4/Gondolin implementation is not on a public remote |
| `workloads/c4-excalidraw` | Extracted from local `excalidraw-mcp` commit `d7c1664` | Continued in this monorepo | Platform-owned workload |

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
