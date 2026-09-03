# Runtimes

Shared runtime integration belongs here. Pi coordinates workloads, Wassette
runs composed WebAssembly suites, and Gondolin supplies optional isolated QEMU
fallbacks. For the C4 workload, Wassette loads `c4-suite.wasm` while Pi invokes
its typed tools. C4-specific orchestration stays in
`workloads/c4-excalidraw`.

## Gondolin browser

`gondolin-browser` runs the official
[`@playwright/mcp`](https://github.com/microsoft/playwright-mcp) server inside a
Gondolin VM. Its Pi extension calls `tools/list` at session start and registers
the returned names, descriptions, and JSON Schemas unchanged. The platform
also loads the SQLite-backed Memory Server. If `GITHUB_TOKEN` is present, it
loads Microsoft's published `github-js` OCI component by pinned digest. Pi
discovers every schema at runtime; no upstream tool definition is copied.

```sh
make gondolin-browser-build memory-sqlite-build
pi --no-extensions --extension ./runtimes/gondolin-browser/pi-extension.ts
```

For browser tasks, Pi can search durable knowledge before navigation and save
useful facts and source relationships afterward. The extension explicitly
forbids storing credentials, cookies, payment data, and instructions copied
from pages. Memory defaults to
`~/.local/share/agent-workload-platform/playwright-memory/data/memory.db`.
Override the component, state directory, or executable with
`WASSETTE_MEMORY_COMPONENT`, `WASSETTE_COMPONENT_DIR`, or `WASSETTE_BIN`.
`WASSETTE_MEMORY_DIR` remains a compatibility alias for the state directory.

## GitHub

Export a fine-grained token to enable the existing component:

```sh
export GITHUB_TOKEN=github_pat_...
pi --no-extensions --extension ./runtimes/gondolin-browser/pi-extension.ts
```

The default Pi surface contains 14 read-only repository, code, issue, pull
request, and workflow-inspection tools selected from the component's 95 tools.
Set `WASSETTE_GITHUB_WRITE=1` only when the session should expose the complete
mutation-capable surface. Wassette grants the component only `api.github.com`
network access and access to `GITHUB_TOKEN`; the component does not receive
filesystem access. `WASSETTE_GITHUB_COMPONENT` can override the pinned OCI
reference.

The generic runtime permits external HTTP by default while Gondolin blocks
internal address ranges. Consumers can supply a host allowlist. The C4 fallback
uses an empty external-host allowlist because its converter is local to the VM.
Playwright MCP is configured to accept Gondolin's intercepted HTTPS connections;
host allowlists and Gondolin remain the network security boundary.
