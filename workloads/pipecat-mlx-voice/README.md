# Pipecat MLX Voice

A private browser voice interface for the Agent Workload Platform on Apple Silicon. Docker Compose
runs the browser-facing voice edge, Tailscale ingress, narrow task gateway, and Postgres. MLX,
Ollama, Pi, Gondolin, and Wassette remain native on macOS where Apple acceleration and VM-backed
tool isolation are available.

[![Deployment and security boundaries](docs/architecture/deployment-security.png)](docs/architecture/deployment-security.excalidraw)

The [C4 architecture views](docs/architecture/README.md) include the editable Excalidraw scene and
SVG render.

## Trust model

- Tailscale Serve is private tailnet ingress; Funnel and public Docker ports are not enabled.
- The voice edge is non-root, read-only, capability-free, resource-bounded, and has no host mount or
  Docker socket.
- Separate bearer capabilities expose only bounded inference and propose/status/approve/cancel.
- Database credentials, Pi/provider authentication, sessions, and workspaces never enter the voice
  container.
- The Pi worker runs on macOS and delegates tools to Gondolin micro-VMs and permission-scoped
  Wassette components.
- Approval is deliberately **YOLO voice approval** for now: Pipecat reads the exact pending plan and
  a later explicit spoken approval releases it. The durable gateway binds approval to the identity,
  proposal, plan hash, and expiry. This is convenient, not phishing-resistant; Face ID/WebAuthn can
  replace only the approval adapter later.

Docker Desktop's Linux VM is the voice-service isolation boundary. Its containers share that VM,
so this is intentionally simpler and weaker than a dedicated per-service micro-VM. The risky agent
tools still execute through Gondolin rather than in the voice stack.

## Start

```bash
cd workloads/pipecat-mlx-voice
make setup
# Fill server/.env using server/.env.example, including fresh random secrets.
make pull-model
make host-preflight
make up
make login
make warm-models
```

`make login` performs interactive Tailscale authentication when needed, binds the exact login and
MagicDNS origin, enables Serve on HTTPS 443, and prints the browser URL.

## Operate

```bash
make status       # Compose services, tailnet state, native service state
make verify       # isolation, capabilities, ingress, broker, and gateway checks
make recreate     # immutable container recreation plus verification
make cycle-test   # three stop/recreate/schema cycles plus final recovery
make down         # stop Compose services; preserve Postgres and Tailscale volumes
make check        # tests, lint, type checks, build, Compose and plist validation
```

Only Postgres is published by Docker, on `127.0.0.1:54329`, so the native Pi worker can consume the
queue. The native inference broker listens on `127.0.0.1:9443`; Docker Desktop makes that protected
capability available as `host.docker.internal`. No service listens on the Mac LAN interface.

See [HOST_REQUIREMENTS.md](HOST_REQUIREMENTS.md) for the host contract and
[docs/architecture](docs/architecture/README.md) for responsibility and threat-boundary details.
