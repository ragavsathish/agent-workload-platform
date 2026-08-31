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
also loads the SQLite-backed Wassette Memory Server and discovers its nine tool
schemas the same way. Pi coordinates the two; Playwright receives neither the
database nor a storage capability.

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
`WASSETTE_MEMORY_COMPONENT`, `WASSETTE_MEMORY_DIR`, or `WASSETTE_BIN`.

The generic runtime permits external HTTP by default while Gondolin blocks
internal address ranges. Consumers can supply a host allowlist. The C4 fallback
uses an empty external-host allowlist because its converter is local to the VM.
Playwright MCP is configured to accept Gondolin's intercepted HTTPS connections;
host allowlists and Gondolin remain the network security boundary.
