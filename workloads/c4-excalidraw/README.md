# C4 to Excalidraw workload

This workload turns native Mermaid C4 source into an editable, policy-approved
Excalidraw scene. Pi coordinates the workflow, Wassette runs the WebAssembly
components, and Dagre computes geometry without a browser. C4-only compiler
and layout modules share one runtime in `c4-engine.wasm`; WAC then packages the
engine with reusable policy and checkpoint blocks as `c4-suite.wasm`. Gondolin
remains an explicit compatibility fallback. No Rust guest code is used.
The tested input matrix covers context, container, component, dynamic, and
deployment views.

## Architecture

### C1 system context

![C1 system context for the Agent Workload Platform](../../docs/architecture/agent-workload-platform-c1.png)

Source: [C1 system context](examples/c1-system-context.mmd)

### C2 container view

[C2 container view source](examples/c2-container.mmd)

Responsibilities are separated as follows:

- `pi-extension.ts` calls the composed compiler, policy, checkpoint, and
  loopback-only web application interfaces.
- `components/` builds the single-runtime C4 engine and reusable Excalidraw
  policy module, then defines their WAC suite composition.
- `core/` builds the checkpoint component used by the Excalidraw application.
- `contracts/c4-pipeline/` contains the WIT interfaces shared across boundaries.
- `../../runtimes/gondolin-browser/` forwards the official Playwright MCP tools
  through Gondolin without copying their schemas.
- `../../adapters/c4-gondolin/` adds only the C4 converter used by the optional
  isolated browser fallback.
- `../../adapters/mermaid-to-excalidraw/` and `../../apps/excalidraw-mcp/` are
  unchanged upstream submodules.

### C3 Pi extension components

[C3 Pi extension source](examples/c3-pi-extension-components.mmd)

The Mermaid files are the current architecture source of truth. The older C2
and C3 PNG renders are intentionally not embedded while they are regenerated
through the updated suite.

The typed C4 graph and `layout-snapshot` remain internal to the C4 engine.
Scene construction stays inside the compiler, and only a scene
accepted by the policy block in `c4-suite.wasm` reaches the application.

## Wasm composition

| Artifact | Current size | Role | Reuse boundary |
|---|---:|---|---|
| `c4-engine.wasm` | 11.90 MiB | C4 parsing, Dagre layout, and scene construction | Internal C4 modules share one runtime |
| `excalidraw-policy.wasm` | 11.05 MiB | Scene admission policy | Independently reusable block |
| `excalidraw-core.wasm` | 11.04 MiB | Scene checkpoint and retrieval | Independently reusable block |
| `c4-suite.wasm` | 34.00 MiB | Production artifact loaded by Wassette | WAC composition of the three blocks |

The suite is assembled without recompiling its blocks. Each TypeScript block
is componentized with its own StarlingMonkey runtime, so WAC composition keeps
module boundaries but does not deduplicate those runtimes. Compiler and layout
are therefore merged because they have no genuine independent consumer. Sizes
are from the verified arm64 build and may vary slightly with toolchain changes.

## Setup

From the repository root:

The verified toolchain is Node.js `26.7.0`, pnpm `11.19.0`, Pi `0.84.4`,
Wassette `0.7.0`, and WAC CLI `0.10.1`. Install Pi with
`pnpm add --global @earendil-works/pi-coding-agent@0.84.4`; install the
Wassette `0.7.0` binary for your platform, then confirm `wassette --version`
before building. Install a prebuilt WAC CLI where available; the command below
uses Cargo only as its installer. The workload itself contains no Rust code.

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
  --no-extensions \
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
build its optional artifact and select it explicitly. Pi calls the official
`browser_navigate` MCP tool; the C4 adapter contributes the converter page and
typed `layout-snapshot`, not another browser API.

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
the single-call compiler against all five view types, checks deterministic and
invalid requests, tests the optional Gondolin adapter, and runs the selected
upstream tests. It does not build the optional Docker/QEMU artifact.

## Contracts and supported syntax

The [C4 pipeline contract](contracts/c4-pipeline/README.md) defines the
single-call engine, two-phase Gondolin compatibility world, and independent
admission-policy world.

Supported Mermaid document types are `C4Context`, `C4Container`,
`C4Component`, `C4Dynamic`, and `C4Deployment`, including deployment nodes and
boundaries supported by the compiler's restricted C4 parser. The accepted
declarations are `Person[_Ext]`, `System[_Ext]`, `Container`, `ContainerDb`,
`ContainerQueue`, `Container_Instance`, `Component`, `Deployment_Node`,
`Node[_L|_R]`, `System_Boundary`, `Container_Boundary`,
`Enterprise_Boundary`, and `Rel[_R|_L|_U|_D]`. Mermaid `Update*`, `Lay_*`,
`SHOW_*`, and `HIDE_*` directives are accepted but intentionally ignored by
the deterministic Dagre renderer.

Current limits:

- `C4Dynamic` is rendered as an editable graph; numbered relationship labels
  preserve order, but it is not a sequence-diagram renderer.
- `Rel_R`, `Rel_L`, `Rel_U`, and `Rel_D` are accepted, but Dagre chooses edge
  routing from the diagram-wide direction.
- Pi currently requests automatic direction and the light theme. The WIT
  compiler also accepts explicit direction and theme options.

The Excalidraw React application remains browser code; it is not compiled to
WebAssembly. The browser displays and edits an already approved scene; it no
longer participates in normal compilation or layout.

## Publish the Wasm component

Install ORAS `1.3.4`, Syft `1.51.1`, and `jq`, then authenticate ORAS to GHCR
with a classic GitHub token carrying `write:packages`:

```bash
echo "$CR_PAT" | oras login ghcr.io -u ragavsathish --password-stdin
make c4-oci-publish
make c4-oci-verify
```

This publishes `c4-suite.wasm` to
`ghcr.io/ragavsathish/agent-workload-platform/c4-suite` as an OCI artifact
tagged `0.1.0` and with the current Git revision. Its SPDX JSON SBOM is attached
as an OCI referrer. Override `C4_OCI_REPOSITORY` to publish elsewhere.
