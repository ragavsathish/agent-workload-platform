# C4 Excalidraw Pipeline Monorepo

This repository owns the complete, reproducible pipeline that turns native
Mermaid C4 into an editable, policy-approved Excalidraw scene:

```text
Pi + C4 skill
  -> Wassette -> c4-compiler.wasm.prepare
  -> Gondolin QEMU VM -> Playwright/Chromium layout adapter
  -> Wassette -> c4-compiler.wasm.finish
  -> Wassette -> excalidraw-policy.wasm.approve
  -> Excalidraw MCP App
```

## Repository layout

```text
.
├── setup.sh                         # install/build the complete system
├── check.sh                         # validate contracts, builds, and tests
├── dogfood.sh                       # run Mermaid C4 through the real pipeline
└── repos/
    ├── excalidraw-mcp/
    │   └── prototype-wassette-pi/   # pipeline owner and Pi/Wassette host
    └── mermaid-to-excalidraw/       # Gondolin/Playwright layout adapter
```

The root scripts are the public interface. Code inside `repos/` is an imported
snapshot, not a nested Git repository. `PROVENANCE.md` records the exact source
commits used to create the monorepo.

## Set up

Requirements: Node.js, npm, pnpm, Wassette, Docker, and Pi.

```bash
./setup.sh
```

If the tagged Gondolin image already exists:

```bash
SKIP_GONDOLIN_BUILD=1 ./setup.sh
```

## Validate

After setup:

```bash
./check.sh
```

## Run the deterministic dogfood workflow

```bash
./dogfood.sh
```

Or provide a different C4 Mermaid source and destination:

```bash
./dogfood.sh path/to/input.mmd path/to/output.excalidraw
```

The default output is written under `artifacts/`, which is intentionally
ignored by Git.

## Run through Pi

```bash
cd repos/excalidraw-mcp
pi \
  --skill ~/.codex/skills/c4-diagrams \
  -e ./prototype-wassette-pi/pi-extension.ts
```

The compiler is kept as a deep module: callers submit C4 source and receive a
scene. Browser layout is the narrow replaceable adapter seam; Excalidraw policy
is independently replaceable because its security rules evolve separately.
