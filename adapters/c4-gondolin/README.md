# Optional C4 Gondolin adapter

This is the compatibility and visual-reference implementation. The normal C4
pipeline uses the browserless layout module inside `c4-engine.wasm` and does
not require this adapter, Docker, Chromium, or QEMU assets.

This platform-owned adapter translates Mermaid C4 into an ordinary flowchart,
passes that flowchart to the unmodified `../mermaid-to-excalidraw` submodule,
and renders it into an SVG DOM through Playwright. It extracts the browser's
computed node, edge, text, and bounds geometry as a typed `layout-snapshot`.
Gondolin can isolate that browser worker in a QEMU micro-VM.

The compiler consumes the typed snapshot, not a raster image.

The upstream submodule contains no platform patches. C4 preprocessing, browser
timeouts, OCI construction, and Gondolin execution live here so upstream pin
updates do not merge with platform implementation files.

To exercise the fallback from the repository root:

```sh
pnpm --dir adapters/c4-gondolin test
make c4-gondolin-build
C4_LAYOUT_BACKEND=gondolin make c4
```

`make c4-gondolin-build` builds the architecture-specific Playwright image and
writes `artifacts/c4-gondolin/<arch>` for the SDK-backed runtime. Docker is
required.
