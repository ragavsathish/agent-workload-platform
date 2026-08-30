# Diagram Pipelines Monorepo

This repository owns multiple reproducible pipelines that turn structured
diagram descriptions into editable, validated visual artifacts.

## Interface

Every pipeline implements the same lifecycle:

```bash
./pipeline list
./pipeline <name> setup
./pipeline <name> check
./pipeline <name> run [pipeline arguments...]
```

The first pipeline is `c4-excalidraw`:

```bash
./pipeline c4-excalidraw setup
./pipeline c4-excalidraw check
./pipeline c4-excalidraw run
```

## Layout

```text
.
├── pipeline                         # common lifecycle dispatcher
├── apps/
│   └── excalidraw-mcp/              # shared interactive editor
├── packages/
│   └── mermaid-to-excalidraw/       # shared browser-layout adapter
└── pipelines/
    └── c4-excalidraw/
        ├── setup.sh
        ├── check.sh
        ├── run.sh
        ├── contracts/
        ├── components/
        └── pi-extension.ts
```

- `pipelines/` contains independently runnable pipeline modules.
- `apps/` contains reusable runnable applications.
- `packages/` contains reusable libraries and adapters.
- Generated dependencies, Wasm builds, loaded components, and pipeline
  artifacts are ignored by Git.

See [pipelines/README.md](pipelines/README.md) for the interface a new pipeline
must implement. Imported source provenance is recorded in `PROVENANCE.md`.

## Compatibility shortcuts

These remain available and delegate through the common interface:

```bash
./setup.sh
./check.sh
./dogfood.sh
```

They operate on `c4-excalidraw`; new automation should prefer `./pipeline`.
