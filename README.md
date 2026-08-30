# Agent Workload Platform

This monorepo lets an agent running on a client machine orchestrate workloads
across local tools, capability-limited WebAssembly modules, isolated Gondolin
micro-VMs, browsers, storage systems, and remote model infrastructure.

C4-to-Excalidraw is the first workload, not the scope of the platform.

## Interface

Every workload implements the same lifecycle:

```bash
./workload list
./workload <name> setup
./workload <name> check
./workload <name> run [workload arguments...]
```

For the current workload:

```bash
./workload c4-excalidraw setup
./workload c4-excalidraw check
./workload c4-excalidraw run
```

## Layout

```text
.
├── workload                         # common lifecycle dispatcher
├── apps/                            # reusable runnable applications
│   └── excalidraw-mcp/
├── workloads/                       # independently runnable agent workloads
│   └── c4-excalidraw/
├── adapters/                        # concrete implementations at external seams
│   └── mermaid-to-excalidraw/
├── components/                      # reusable WIT/WebAssembly modules
└── runtimes/                        # Pi, Wassette, Gondolin runtime integration
```

Workload-specific contracts, prompts, examples, and modules remain inside the
workload until another workload genuinely reuses them. Shared implementations
then move to `components/`, `adapters/`, `apps/`, or `runtimes/` according to
their responsibility.

See [workloads/README.md](workloads/README.md) for the interface a new workload
must implement. Imported source provenance is recorded in `PROVENANCE.md`.

## Compatibility shortcuts

The following delegate to the `c4-excalidraw` workload:

```bash
./setup.sh
./check.sh
./dogfood.sh
```

New automation should use `./workload` directly.
