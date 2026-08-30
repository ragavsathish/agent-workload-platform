# Imported repository snapshots

The monorepo was assembled from these local commits on 2026-08-30:

| Directory | Original repository | Branch | Commit |
|---|---|---|---|
| `apps/excalidraw-mcp` | `excalidraw-mcp` | `main` | `d7c1664` — `feat: add composable C4 Excalidraw pipeline` |
| `adapters/mermaid-to-excalidraw` | `mermaid-to-excalidraw` | `master` | `e7ce159` — `feat: add C4 Gondolin layout worker` |
| `workloads/c4-excalidraw` | extracted from the `excalidraw-mcp` snapshot | `main` | `d7c1664` |

The directories are committed snapshots rather than Git submodules. This keeps
one atomic version of the complete workload and allows cross-repository changes
to be reviewed and committed together.
