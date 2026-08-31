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
adds only the MCP-over-Gondolin transport; it does not redefine browser tools.

```sh
make gondolin-browser-build
pi --no-extensions --extension ./runtimes/gondolin-browser/pi-extension.ts
```

The generic runtime permits external HTTP by default while Gondolin blocks
internal address ranges. Consumers can supply a host allowlist. The C4 fallback
uses an empty external-host allowlist because its converter is local to the VM.
Playwright MCP is configured to accept Gondolin's intercepted HTTPS connections;
host allowlists and Gondolin remain the network security boundary.
