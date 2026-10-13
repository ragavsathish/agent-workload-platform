# Monorepo organization

The repository is organized around product and bounded-context ownership.
Voice Agent and Architecture Visualization are product vertical slices;
Agent Execution is the first shared platform context. Earendil remains the one
transitional area until its local work is ready for an isolated migration.

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

| Path | Ownership | Status or next focused change |
| --- | --- | --- |
| `products/voice-agent` | Voice Agent product | Canonical; the obsolete `workloads/pipecat-mlx-voice` copy is removed |
| `products/architecture-visualization` | Architecture Visualization product | Canonical vertical slice including C4 components, contracts, examples, and its Gondolin integration |
| `platform/agent-execution/gondolin-session` | Agent Execution platform context | Shared by Voice Agent and Architecture Visualization; product-specific voice services are excluded |
| `vendor/excalidraw-mcp` | Upstream vendor source | Pinned, unmodified Git submodule |
| `vendor/mermaid-to-excalidraw` | Upstream vendor source | Pinned, unmodified Git submodule |
| `runtimes/k3s-earendil` | Future Secure Agent Workspace product | Migrate only when its local source is ready; replace its source-tree C4 dependency with an artifact contract |

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

1. **Voice Agent product boundary** — complete.
2. **Vendor isolation** — complete.
3. **Architecture Visualization product** — complete.
4. **Agent Execution platform context** — complete for the two current
   consumers.
5. **Secure Agent Workspace product** — move the Earendil deployment and make
   capability inputs explicit artifacts.
6. **Enforcement and cleanup** — add ownership rules, path-scoped CI, dependency
   checks, and delete obsolete technical buckets.
