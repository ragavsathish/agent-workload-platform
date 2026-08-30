# Agent Workload Platform

This monorepo lets an agent running on a client machine orchestrate workloads
across local tools, capability-limited WebAssembly modules, isolated Gondolin
micro-VMs, browsers, storage systems, and remote model infrastructure.

C4-to-Excalidraw is the first workload, not the scope of the platform.

## Current package

```bash
cd workloads/c4-excalidraw
npm run build
npm test
npm run c4
```

## Layout

```text
.
├── apps/                            # reusable runnable applications
│   └── excalidraw-mcp/              # pinned upstream Git submodule
├── workloads/                       # independently runnable agent workloads
│   └── c4-excalidraw/
├── adapters/                        # concrete implementations at external seams
│   ├── mermaid-to-excalidraw/      # untouched upstream Git submodule
│   └── c4-gondolin/                # platform-owned C4/browser adapter
├── components/                      # reusable WIT/WebAssembly modules
└── runtimes/                        # Pi, Wassette, Gondolin runtime integration
```

Workload-specific contracts, prompts, examples, and modules remain inside the
workload until another workload genuinely reuses them. Shared implementations
then move to `components/`, `adapters/`, `apps/`, or `runtimes/` according to
their responsibility.

There is no repository-specific dispatcher or lifecycle wrapper. Each package
uses its native toolchain. See the C4 package README for dependency setup.
Imported source provenance is recorded in `PROVENANCE.md`.
