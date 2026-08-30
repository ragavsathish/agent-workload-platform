# Agent Workload Platform

This monorepo lets an agent running on a client machine orchestrate workloads
across local tools, capability-limited WebAssembly modules, isolated Gondolin
micro-VMs, browsers, storage systems, and remote model infrastructure.

C4-to-Excalidraw is the first workload, not the scope of the platform.

## Run the current workload

```bash
./workloads/c4-excalidraw/setup.sh
./workloads/c4-excalidraw/check.sh
./workloads/c4-excalidraw/run.sh
```

## Layout

```text
.
├── apps/                            # reusable runnable applications
│   └── excalidraw-mcp/              # pinned upstream Git submodule
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

See [workloads/README.md](workloads/README.md) for the minimal layout of a new
workload. Imported source provenance is recorded in `PROVENANCE.md`.

`setup` initializes the submodules required by its workload. A full checkout
can also be prepared eagerly with `git clone --recurse-submodules` or
`git submodule update --init --recursive`.
