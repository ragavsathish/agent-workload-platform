# Agent Workload Platform

This monorepo lets an agent running on a client machine orchestrate workloads
across local tools, capability-limited WebAssembly modules, isolated Gondolin
micro-VMs, browsers, storage systems, and remote model infrastructure.

C4-to-Excalidraw is the first workload, not the scope of the platform.

![C1 system context for the Agent Workload Platform](docs/architecture/agent-workload-platform-c1.png)

_C1 system context rendered from the policy-approved Excalidraw scene._

## C4 workload

```bash
corepack enable
pnpm install --frozen-lockfile --ignore-scripts
make c4-build
make c4-test
make c4
```

`make c4` invokes the real Pi extension and writes an approved editable scene
to `artifacts/c4-excalidraw/composable-c4-pipeline.excalidraw`. Override
`C4_INPUT`, `C4_OUTPUT`, or `C4_MODEL` on the command line when needed.

The source-controlled architecture views are:

- [C1 system context](workloads/c4-excalidraw/examples/c1-system-context.mmd)
- [C2 container view](workloads/c4-excalidraw/examples/c2-container.mmd)
- [C3 Pi extension components](workloads/c4-excalidraw/examples/c3-pi-extension-components.mmd)

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

There is no repository-specific dispatcher or lifecycle wrapper. A single pnpm
workspace installs and runs every JavaScript package. Upstream lockfiles remain
inside untouched Git submodules for provenance but are not used by the platform
workflow. See the C4 package README for dependency setup. Imported source
provenance is recorded in `PROVENANCE.md`.
