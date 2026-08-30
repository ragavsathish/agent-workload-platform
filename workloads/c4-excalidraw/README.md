# C4 to Excalidraw workload

This workload turns native Mermaid C4 source into an editable, policy-approved
Excalidraw scene. Pi coordinates the workflow, Wassette runs the WebAssembly
components, and a Dagre layout component computes geometry without a browser.
The compiler and layout modules are statically composed into
`c4-pipeline.wasm`; Gondolin remains an explicit compatibility fallback.

## Architecture

### C1 system context

![C1 system context for the Agent Workload Platform](../../docs/architecture/agent-workload-platform-c1.png)

Source: [C1 system context](examples/c1-system-context.mmd)

### C2 container view

![C2 container view for the C4-to-Excalidraw workload](../../docs/architecture/agent-workload-platform-c2.png)

Source: [C2 container view](examples/c2-container.mmd)

Responsibilities are separated as follows:

- `pi-extension.ts` calls the composed compiler, policy, checkpoint, and
  loopback-only web application interfaces.
- `components/` builds the capability-limited C4 compiler, Dagre layout, and
  Excalidraw policy components. WAC connects the compiler's `graph-layout`
  import to the layout implementation.
- `core/` builds the checkpoint component used by the Excalidraw application.
- `contracts/c4-pipeline/` contains the WIT interfaces shared across boundaries.
- `../../adapters/c4-gondolin/` contains the optional isolated browser fallback.
- `../../adapters/mermaid-to-excalidraw/` and `../../apps/excalidraw-mcp/` are
  unchanged upstream submodules.

### C3 Pi extension components

![C3 component view for the Pi coordinator](../../docs/architecture/agent-workload-platform-c3.png)

Source: [C3 Pi extension components](examples/c3-pi-extension-components.mmd)

The typed C4 graph and `layout-snapshot` remain internal to the composed Wasm
pipeline. Scene construction stays inside the compiler, and only a scene
accepted by `excalidraw-policy.wasm` reaches the application.

## Setup

From the repository root:

The verified toolchain is Node.js `26.7.0`, pnpm `11.19.0`, Rust/Cargo
`1.92.0`, Pi `0.84.4`, Wassette `0.7.0`, and WAC CLI `0.10.1`. Install Pi with
`pnpm add --global @earendil-works/pi-coding-agent@0.84.4`; install the
Wassette `0.7.0` binary for your platform, then confirm `wassette --version`
before building.

```bash
git submodule update --init --recursive
corepack enable
corepack prepare pnpm@11.19.0 --activate
cargo install wac-cli --version 0.10.1 --locked
pnpm install --frozen-lockfile --ignore-scripts
make c4-build
```

The repository invokes only pnpm. The upstream submodules retain their own
lockfiles unchanged, but the root `pnpm-lock.yaml` controls platform builds.

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

The default path is browserless. To exercise the isolated Chromium fallback,
build its optional artifact and select it explicitly:

```bash
make c4-gondolin-build
C4_LAYOUT_BACKEND=gondolin make c4 \
  C4_INPUT=workloads/c4-excalidraw/examples/composable-c4-pipeline.mmd
```

## Verify

```bash
make c4-test
```

This validates every WIT world, rebuilds and composes the components, exercises
the single-call compiler and Wassette checkpoint round trips, tests the optional
Gondolin adapter, and runs the selected upstream converter tests. It does not
build the optional Docker/QEMU artifact.

## Contracts and supported syntax

The [C4 pipeline contract](contracts/c4-pipeline/README.md) defines the
single-call compiler, typed graph-layout seam, two-phase Gondolin compatibility
world, and independent admission-policy world.

Supported Mermaid document types are `C4Context`, `C4Container`,
`C4Component`, `C4Dynamic`, and `C4Deployment`, including deployment nodes and
boundaries supported by the compiler's restricted C4 parser. The accepted
declarations are `Person[_Ext]`, `System[_Ext]`, `Container`, `ContainerDb`,
`ContainerQueue`, `Container_Instance`, `Component`, `Deployment_Node`,
`Node[_L|_R]`, `System_Boundary`, `Container_Boundary`,
`Enterprise_Boundary`, and `Rel[_R|_L|_U|_D]`. Mermaid `Update*`, `Lay_*`,
`SHOW_*`, and `HIDE_*` directives are accepted but intentionally ignored by
the deterministic Dagre renderer.

The Excalidraw React application remains browser code; it is not compiled to
WebAssembly. The browser displays and edits an already approved scene; it no
longer participates in normal compilation or layout.
