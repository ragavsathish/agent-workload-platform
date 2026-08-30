# Composable C4 pipeline contract

This WIT package defines independently replaceable compiler, layout, and policy
modules:

```mermaid
flowchart TD
    source[C4 source] --> compiler[c4-compiler]
    compiler --> graph[typed C4 graph]
    graph --> layout[c4-layout / Dagre]
    layout --> snapshot[layout-snapshot]
    snapshot --> compiler
    compiler --> policy[excalidraw-policy]
    policy --> scene[Approved Excalidraw scene]
```

The external compiler interface deliberately has one operation: `compile`.
Parsing, layout delegation, layout validation, and Excalidraw construction are
implementation details hidden behind that interface.

## Worlds

- `c4-compiler` imports `graph-layout` and exports the single-call `compiler`
  interface.
- `c4-layout-component` exports a browserless Dagre implementation of
  `graph-layout`.
- WAC plugs those two worlds into `c4-pipeline.wasm`, which has no functional
  host-capability imports and is loaded by Wassette.
- `c4-compiler-core` retains `prepare` and `finish` only for the explicit
  Gondolin/Playwright compatibility path.
- `excalidraw-policy-component` validates compiler output independently. It
  remains a separate world so compiler and security-policy implementations can
  evolve or be replaced independently.

Layout implementations return typed geometry, not Excalidraw JSON. Therefore
the compiler retains scene construction and rejects malformed or excessive
layout output before creating a scene.

## Invariants

- `prepared-compilation.state` is opaque and must be returned to `finish`
  without modification.
- A layout snapshot may contain only finite coordinates within the compiler's
  configured limits.
- Node and edge identifiers must refer to entities in the prepared compiler
  state.
- `scene-envelope.format` is `excalidraw`; `format-version` currently equals
  `2`.
- Only a scene returned by `excalidraw-policy.approve` may reach the browser or
  the checkpoint store.
- The composed default component has no filesystem, network, clock, randomness,
  process, or browser capability imports.
- The optional Gondolin adapter remains outside the composed component and may
  supply only a typed `layout-snapshot` to `finish`.

## Validate

From the repository root:

```sh
sh workloads/c4-excalidraw/contracts/c4-pipeline/validate.sh
```

The validator generates JavaScript bindings for every world with `jco types`.
Generated files are temporary and are not committed.
