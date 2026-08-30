# Composable C4 pipeline contract

This WIT package defines three independently replaceable modules:

```text
C4 source
   |
   v
c4-compiler
   | imports browser-layout
   |          |
   |          +-- Gondolin + Playwright adapter (production)
   |          +-- deterministic in-memory adapter (tests)
   v
excalidraw-policy
   |
   v
approved Excalidraw scene
```

The external compiler interface deliberately has one operation: `compile`.
Parsing, browser delegation, layout validation, and Excalidraw construction are
implementation details hidden behind that interface.

## Worlds

- `c4-compiler` is the target world. It imports `browser-layout` and exports the
  single-call `compiler` interface.
- `c4-compiler-core` is the compatibility world for a host that cannot yet
  satisfy custom imports. Pi calls `prepare`, sends the render request to the
  Gondolin adapter, and passes the returned snapshot to `finish`.
- `excalidraw-policy-component` validates compiler output independently. It
  remains a separate world so compiler and security-policy implementations can
  evolve or be replaced independently.

The browser adapter returns typed geometry, not Excalidraw JSON. Consequently,
the browser worker cannot take ownership of scene construction and the compiler
can reject malformed or excessive browser output before creating a scene.

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
- The Gondolin browser adapter receives no general filesystem, process, or
  browser-automation interface through WIT; it implements only `render`.

## Validate

```sh
sh validate.sh
```

The validator generates JavaScript bindings for every world with `jco types`.
Generated files are temporary and are not committed.
