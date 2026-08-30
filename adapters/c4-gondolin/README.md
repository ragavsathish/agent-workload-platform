# C4 Gondolin adapter

This platform-owned adapter translates Mermaid C4 into an ordinary flowchart,
passes that flowchart to the unmodified `../mermaid-to-excalidraw` submodule,
and renders it into an SVG DOM through Playwright. It extracts the browser's
computed node, edge, text, and bounds geometry as a typed `layout-snapshot`.
Gondolin can isolate that browser worker in a QEMU micro-VM.

The compiler consumes the typed snapshot, not a raster image.

The upstream submodule contains no platform patches. C4 preprocessing, browser
timeouts, OCI construction, and Gondolin execution live here so upstream pin
updates do not merge with platform implementation files.

From the repository root:

```sh
git submodule update --init --recursive -- adapters/mermaid-to-excalidraw
yarn --cwd adapters/mermaid-to-excalidraw install --frozen-lockfile --ignore-scripts
yarn --cwd adapters/mermaid-to-excalidraw build
npm --prefix adapters/c4-gondolin ci --ignore-scripts
npm --prefix adapters/c4-gondolin test
npm --prefix adapters/c4-gondolin run gondolin:build
```
