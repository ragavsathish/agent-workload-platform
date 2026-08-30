# C4 to Excalidraw workload

This workload turns native Mermaid C4 source into an editable, policy-approved
Excalidraw scene. Pi coordinates the workflow, Wassette runs the WebAssembly
components, and Gondolin isolates the browser-only layout step in a QEMU
micro-VM.

## Architecture

```text
Pi + C4 skill -> native Mermaid C4
  -> Wassette -> c4-compiler.wasm.prepare
  -> Gondolin QEMU VM -> Playwright/Chromium
       returns typed nodes, edges, text, and bounds
  -> Wassette -> c4-compiler.wasm.finish
       constructs the Excalidraw scene
  -> Wassette -> excalidraw-policy.wasm.approve
       rejects unsafe or malformed scenes
  -> Excalidraw MCP App -> edit and save
```

Responsibilities are separated as follows:

- `pi-extension.ts` coordinates Wassette, Gondolin, and the loopback-only web
  application.
- `components/` builds the capability-limited C4 compiler and Excalidraw policy
  components.
- `core/` builds the checkpoint component used by the Excalidraw application.
- `contracts/c4-pipeline/` contains the WIT interfaces shared across boundaries.
- `../../adapters/c4-gondolin/` owns C4 preprocessing and isolated browser
  layout.
- `../../adapters/mermaid-to-excalidraw/` and `../../apps/excalidraw-mcp/` are
  unchanged upstream submodules.

Only a typed `layout-snapshot` leaves the browser worker. Scene construction
stays inside `c4-compiler.wasm`, and only a scene accepted by
`excalidraw-policy.wasm` reaches the application.

## Setup

From the repository root:

```bash
git submodule update --init --recursive
pnpm --dir apps/excalidraw-mcp install --ignore-scripts --frozen-lockfile
pnpm --dir apps/excalidraw-mcp run build
yarn --cwd adapters/mermaid-to-excalidraw install --frozen-lockfile --ignore-scripts
yarn --cwd adapters/mermaid-to-excalidraw build
npm --prefix adapters/c4-gondolin ci --ignore-scripts
npm --prefix workloads/c4-excalidraw ci --ignore-scripts
npm --prefix workloads/c4-excalidraw/core ci --ignore-scripts
npm --prefix workloads/c4-excalidraw/components ci --ignore-scripts
make c4-build
npm --prefix workloads/c4-excalidraw run gondolin:build
```

The Wasm guests use WIT as their source of truth. Their builds regenerate Jco
guest declarations, type-check the TypeScript, compile it to an ignored ESM
intermediate, and componentize the JavaScript. See
[`Wasm, WIT, and TypeScript best practices`](../../docs/research/wasm-wit-typescript-best-practices.md).

## Run

To let Pi create and render a diagram interactively:

```bash
pi \
  --skill ~/.codex/skills/c4-diagrams \
  --extension ./workloads/c4-excalidraw/pi-extension.ts
```

Ask Pi to create one C4 view and render it in Excalidraw. The extension exposes
`excalidraw_c4_render`, which accepts the complete native Mermaid source.

To run an existing Mermaid file non-interactively:

```bash
make c4 \
  C4_INPUT=workloads/c4-excalidraw/examples/composable-c4-pipeline.mmd \
  C4_OUTPUT=artifacts/c4-excalidraw/composable-c4-pipeline.excalidraw
```

`C4_MODEL` selects the Pi model. It defaults to
`openai-codex/gpt-5.6-terra`. The model dispatches the attached source to the
tool; the compiler and policy components produce the output.

## Verify

```bash
make c4-test
```

This validates the WIT contracts, builds and loads the components, tests the
Gondolin adapter, and runs the selected upstream converter tests.

## Contracts and supported syntax

The [C4 pipeline contract](contracts/c4-pipeline/README.md) defines the target
single-call compiler world, the current two-phase Wassette compatibility world,
and the independent admission-policy world.

Supported Mermaid document types are `C4Context`, `C4Container`,
`C4Component`, `C4Dynamic`, and `C4Deployment`, including deployment nodes and
boundaries supported by the pinned Mermaid renderer.

The Excalidraw React application remains browser code; it is not compiled to
WebAssembly. Wassette constrains the compiler and policy components, while
Gondolin contains Chromium and its Node adapter.
