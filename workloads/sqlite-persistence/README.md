# SQLite-backed Wassette Memory Server

This component implements the same `microsoft:memory-js` WIT interface as
Wassette's Memory Server, but keeps the knowledge graph in SQLite instead of
JavaScript arrays.

```text
Pi -> Wassette -> memory-sqlite.wasm -> data/memory.db
                    C + SQLite          scoped WASI filesystem
```

Pi sees the same nine tools: create, read, search, open, and delete operations
for entities, relations, and observations. It does not receive raw SQL or a
filesystem tool. Search retains the Memory Server's substring behavior; this
is agent memory, not a workflow engine or vector database.

The [Gondolin browser runtime](../../runtimes/README.md) loads this component
beside Playwright. Pi—not the browser—decides which prior facts to recall and
which durable browser findings to store.

## Build and test

Requirements: Docker, pnpm 11.19.0, and Wassette 0.7.0. The build verifies
SQLite 3.53.4 and wit-bindgen 0.61.1, and uses the pinned
`ghcr.io/webassembly/wasi-sdk:wasi-sdk-33` image. No Rust guest code is used.

```bash
pnpm install --frozen-lockfile
make memory-sqlite-build
make WASSETTE=/path/to/wassette memory-sqlite-test
```

The test calls the real MCP tools and proves the graph survives a Wassette
process restart.

## Load

```bash
wassette component load file://"$PWD/workloads/sqlite-persistence/dist/memory-sqlite.wasm"
wassette permission grant storage memory-sqlite fs://data --access read,write
wassette run
```

The only state is `data/memory.db` under Wassette's component directory. The
component requests no network capability.
