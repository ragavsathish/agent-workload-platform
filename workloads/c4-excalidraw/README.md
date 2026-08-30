# PROTOTYPE: Pi + Wassette Excalidraw bridge

This integration now implements the composable C4 pipeline:

> Can Pi compile native Mermaid C4 into an editable, policy-approved Excalidraw
> scene while isolating browser-only layout inside a Gondolin micro-VM?

The integration glue is deliberately isolated, but it reuses the clone's real
`src/mcp-app.tsx` build rather than maintaining a second renderer or editor.

The split is intentional:

- `../src/mcp-app.tsx` remains the browser renderer/editor.
- `components/` builds the capability-limited `c4-compiler.wasm` and
  `excalidraw-policy.wasm` modules.
- `core/` retains the checkpoint compatibility module used by the cloned app.
- `host.ts` is a thin MCP Apps parent bridge.
- `pi-extension.ts` owns orchestration and the loopback-only HTTP server.
- `adapters/mermaid-to-excalidraw` is the untouched upstream converter.
- `adapters/c4-gondolin` supplies C4 preprocessing and the narrow
  Gondolin/Playwright browser-layout adapter around it.

## Install and build

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
npm --prefix workloads/c4-excalidraw run build
npm --prefix workloads/c4-excalidraw run components:load
npm --prefix workloads/c4-excalidraw run gondolin:build
```

These are standard toolchain commands: there is no platform setup wrapper.
Run `npm test` from `workloads/c4-excalidraw` to build and verify the package.

## Run with Pi

```bash
cd /path/to/agent-workload-platform
pi -e ./workloads/c4-excalidraw/pi-extension.ts
```

For the C4-to-Excalidraw workflow, load the C4 skill as well:

```bash
pi \
  --skill ~/.codex/skills/c4-diagrams \
  -e ./workloads/c4-excalidraw/pi-extension.ts
```

Then ask, for example:

```text
Create a C4 Container diagram of Pi, Wassette, and the Excalidraw MCP App,
then render it in Excalidraw.
```

To exercise the same Wasm/Gondolin/Wassette phases without asking a model to
make the tool call, use the deterministic dogfood runner:

```bash
npm --prefix workloads/c4-excalidraw run c4 -- \
  examples/composable-c4-pipeline.mmd \
  ../../artifacts/c4-excalidraw/composable-c4-pipeline.excalidraw
```

This is the authoritative compiler path. Inside Gondolin, Mermaid renders the
source into an SVG DOM so Chromium can compute layout. Only a typed
`layout-snapshot` crosses the browser boundary into `c4-compiler.wasm`; the
compiler emits Excalidraw JSON. Set `RENDER_PNG=0` to skip the optional final
preview.

## Experimental GPT vision workflow

The repository also retains an experimental model-driven workflow. It renders
Mermaid as a PNG visual reference and lets GPT construct editable Excalidraw
JSON from both the semantic source and that image:

```bash
./workloads/c4-excalidraw/run-gpt-c4-workflow.sh
```

The script uses `openai-codex/gpt-5.6-terra` by default. Override it with
`PI_C4_MODEL`. It renders `examples/pi-wassette-excalidraw.mmd` through Mermaid,
attaches both `.mmd` and `.png` to Pi, allows only `excalidraw_wassette_open`,
and writes validated state plus the authoritative loopback URL under
`artifacts/`. The PNG is model input only; it never enters the deterministic C4
compiler. Read the URL from the result JSON rather than copying it from model
prose.

In this experimental path, Pi applies the C4 skill; Mermaid supplies a stable
visual reference; GPT translates the source and image to standard, editable
Excalidraw elements; Wassette validates and checkpoints those elements; and the
cloned MCP App renders them.

## Generate any C4 diagram with local Qwen vision

The LM Studio registration in `~/.pi/agent/models.json` must declare both
`text` and `image` input for `qwen/qwen3.8-27b`. The model's vision endpoint was
verified directly using the golden Mermaid PNG; this metadata is what lets Pi
attach that image.

```bash
./workloads/c4-excalidraw/run-qwen-c4-request.sh \
  'Show a C4 container diagram for a user, Pi, Wassette, and Excalidraw'
```

The first Qwen call applies the C4 skill to turn the request into Mermaid. The
second sees both that semantic source and its rendered PNG, then constructs the
editable scene through Wassette. Like the GPT workflow, this is a vision-model
experiment rather than the deterministic compiler path. The request may also be
a text-file path. Each run is evaluated against its own Mermaid source with
`evaluate-c4.mjs`: required labels and descriptions, C4 shape/relationship
counts, valid geometry, and Wassette warnings. It does not compare serialized
bytes, IDs, precise coordinates, colors, checkpoints, or URLs.

To bypass request modeling when Mermaid already exists, call
`run-qwen-c4-workflow.sh path/to/diagram.mmd`. Set `EVALUATE_GOLDEN=1` only when
running the known regression fixture. The evaluator compares C4 text,
element-type counts, and Wassette warnings while deliberately ignoring bytes,
nondeterministic IDs, exact coordinates, checkpoint IDs, and loopback URLs.

Deployment views are supported through Mermaid's native `C4Deployment` and
`Deployment_Node` grammar. See `examples/gondolin-c4-deployment.mmd`.

Passing this single golden case establishes reproduction, not generalization.
A broader evaluation should add unseen C4 diagrams and score entity and
relationship preservation, boundary containment, overlaps, connector routing,
and rendered-image similarity.

`excalidraw_c4_render` is the composable path. Pi sends source to
`c4-compiler.wasm#prepare`, invokes the Gondolin adapter for typed geometry,
sends that snapshot to `c4-compiler.wasm#finish`, and admits the resulting scene
through `excalidraw-policy.wasm#approve` before display or checkpointing.

Ask Pi to call `excalidraw_wassette_open` with an Excalidraw JSON array. The
extension calls the privately loaded component through Wassette, opens the
clone's real MCP App on a token-protected loopback URL, and sends debounced
fullscreen edits through the component before storing the normalized checkpoint.

Wassette creates a fresh component instance for each invocation, so the Pi
extension owns the in-memory checkpoint map. The component remains stateless:
all create, restore, delete, and edit payloads cross the Wassette boundary for
validation and normalization. Closing Pi destroys the checkpoints.

## Runtime flow

```text
Pi + C4 skill -> native Mermaid C4
  -> Wassette -> c4-compiler.wasm.prepare
  -> Gondolin QEMU VM -> Playwright/Chromium layout adapter
       returns typed nodes, edges, text, bounds (not Excalidraw JSON)
  -> Wassette -> c4-compiler.wasm.finish
       constructs the Excalidraw scene
  -> Wassette -> excalidraw-policy.wasm.approve
       rejects unsafe, malformed, dangling, or excessive scenes
  -> cloned Excalidraw MCP App -> edit/save approved scene
```

This does not move the Excalidraw React application into WebAssembly. It keeps
the UI in the browser and puts the stateful tool capability behind Wassette.

The composable compiler contract lives in
[`contracts/c4-pipeline`](contracts/c4-pipeline/README.md). It keeps the C4
compiler and Excalidraw policy module as separate WIT worlds and models Gondolin/Playwright
as the compiler's narrow browser-layout import. A two-phase compatibility world
supports the current Pi-orchestrated runtime until Wassette can supply that
custom import directly.

## Supported Mermaid C4 subset

The compiler accepts Mermaid documents beginning with `C4Context`,
`C4Container`, `C4Component`, `C4Dynamic`, or `C4Deployment`. Syntax support
inside those documents is supplied by the pinned Mermaid browser renderer,
including deployment nodes and boundaries.
