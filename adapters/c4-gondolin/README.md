# Optional C4 Gondolin adapter

This is the compatibility and visual-reference implementation. The normal C4
pipeline uses the browserless layout module inside `c4-engine.wasm` and does
not require this adapter, Docker, Chromium, or QEMU assets.

This platform-owned adapter translates Mermaid C4 into an ordinary flowchart
and passes it to the unmodified `../mermaid-to-excalidraw` submodule. The
official Playwright MCP server navigates Chromium to that converter inside a
Gondolin QEMU micro-VM. The converter returns computed node, edge, text, and
bounds geometry as a typed `layout-snapshot`.

The compiler consumes the typed snapshot, not a raster image.

The upstream submodule contains no platform patches. The reusable MCP transport
lives in `../../runtimes/gondolin-browser`; this adapter owns only C4
preprocessing, the converter page, its small result sidecar, and the extended
VM image. Browser tool definitions come directly from Playwright MCP.

To exercise the fallback from the repository root:

```sh
pnpm --dir adapters/c4-gondolin test
make c4-gondolin-build
C4_LAYOUT_BACKEND=gondolin make c4
```

`make c4-gondolin-build` extends the pinned Playwright MCP image with the C4
converter and writes `artifacts/c4-gondolin/<arch>` for the SDK-backed runtime.
Docker is required.
