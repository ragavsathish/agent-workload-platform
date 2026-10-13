# Monorepo organization

The repository is moving incrementally from technical top-level buckets to
product and bounded-context ownership. The Voice Agent is the first product at
`products/voice-agent`; all other paths remain operational until a focused move
can preserve their builds and tests.

## Dependency direction

```text
products  ───────▶ platform contexts ───────▶ external systems
   │                                                ▲
   └───────▶ product-local integrations ──────────┘

platform ───╳ products
product A ──╳ product B internals
vendor ────╳ platform-owned modifications
```

A product owns its applications, services, workers, contracts, deployment
profiles, tests, documentation, and domain vocabulary. A platform context must
have a stable contract and at least two real product consumers. A deployment
profile stays with the product it deploys rather than becoming a runtime merely
because it uses Docker, macOS LaunchAgents, or Kubernetes.

## Current and target ownership

| Current path | Target ownership | Next focused change |
| --- | --- | --- |
| `products/voice-agent` | Voice Agent product | Separate its browser app and independently deployed Python/Node processes only after package contracts are explicit |
| `workloads/c4-excalidraw` | `products/architecture-visualization` | Move the C4 compiler, capability components, contracts, examples, tests, and application as one vertical slice |
| `adapters/c4-gondolin` | Architecture Visualization integration | Move with the C4 product because it has no second consumer |
| `runtimes/k3s-earendil` | `products/secure-agent-workspace` | Move images, policies, manifests, media worker, and tests together; replace its source-tree C4 dependency with an artifact contract |
| `runtimes/gondolin-browser` | `platform/agent-execution/gondolin-session` plus product adapters | The Voice Agent service is separated; move the remaining generic runtime after C4 dependencies are made explicit |
| `apps/excalidraw-mcp` | `vendor/excalidraw-mcp` | Move the unchanged submodule and update provenance/build references |
| `adapters/mermaid-to-excalidraw` | `vendor/mermaid-to-excalidraw` | Move the unchanged submodule with the same vendor policy |
| `components` | No root source owner | Remove artifact symlinks; keep generated capability artifacts with the producing product |

## Voice Agent boundary

The Voice Agent moved as one vertical slice before its internal services were
rearranged. This keeps Compose build contexts, macOS installation, ignored
secrets, local virtual environments, and existing verification commands
working together. Its current internal directories are therefore transitional
but explicitly owned:

```text
products/voice-agent/
├── client/       browser application
├── edge/         Pipecat/WebRTC voice edge
├── gateway/      task-gateway container package
├── services/
│   └── pi-agent/ persistent Pi voice session and isolated tools
├── server/       native inference, worker, and orchestration modules
├── deploy/       Compose, macOS, tailnet, secrets, and observability
├── scripts/      lifecycle and verification commands
└── docs/         product architecture and research
```

The next internal split should be behavior-preserving:

1. Give the browser app, voice edge, task gateway, inference broker, and task
   worker independently buildable packages.
2. Extract shared task lifecycle types before separating gateway and worker
   Python environments.
3. Keep Compose and macOS profiles under the product, referencing service
   package roots explicitly.
4. Run the existing product `make check`, black-box voice test, Compose
   validation, and host preflight after each move.

## Repository rules

- Do not import source directly from one product into another.
- Keep product-specific code local until a second consumer proves reuse.
- Treat WIT, HTTP, queue, and artifact schemas as contracts, not shared utility
  folders.
- Keep immutable upstream code under `vendor/` and record its digest or commit
  in `PROVENANCE.md`.
- Use one root pnpm lock for platform-owned JavaScript packages and one uv lock
  per independently deployable Python environment.
- Root commands are dispatchers; product directories own their complete build,
  test, run, and deployment behavior.
- Add import and path-boundary checks before the second product migration.

## Migration sequence

1. **Voice Agent product boundary** — move the product, glossary, links, and
   architecture ownership without changing runtime behavior.
2. **Vendor isolation** — move both unchanged Excalidraw submodules and update
   provenance.
3. **Architecture Visualization product** — move C4 and its product-local
   Gondolin integration.
4. **Secure Agent Workspace product** — move the Earendil deployment and make
   capability inputs explicit artifacts.
5. **Platform extraction** — retain only execution, orchestration, capability,
   or observability code with multiple consumers.
6. **Enforcement and cleanup** — add ownership rules, path-scoped CI, dependency
   checks, and delete obsolete technical buckets.
