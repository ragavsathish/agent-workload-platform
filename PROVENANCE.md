# Imported repository snapshots

The monorepo was assembled from these local commits on 2026-08-30:

| Directory | Original repository | Branch | Commit |
|---|---|---|---|
| `repos/excalidraw-mcp` | `excalidraw-mcp` | `main` | `d7c1664` — `feat: add composable C4 Excalidraw pipeline` |
| `repos/mermaid-to-excalidraw` | `mermaid-to-excalidraw` | `master` | `e7ce159` — `feat: add C4 Gondolin layout worker` |

The directories are committed snapshots rather than Git submodules. This keeps
one atomic version of the complete pipeline and allows cross-repository changes
to be reviewed and committed together.
