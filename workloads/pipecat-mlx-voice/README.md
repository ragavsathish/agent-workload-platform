# Pipecat MLX Voice

A private browser voice assistant for Apple Silicon. MLX Whisper, Ollama, and MLX Kokoro stay on
macOS; the browser-facing code runs in a dedicated rootless Podman micro-VM.

## Architecture

The source-controlled [C4 architecture views](docs/architecture/README.md)
define the system scope, runtime responsibilities, deployment topology, and
security boundaries:

- [C1 system context](docs/architecture/c1-system-context.mmd)
- [C2 container view](docs/architecture/c2-container.mmd)
- [Deployment and security view](docs/architecture/deployment-security.mmd)

The Mermaid sources are authoritative and trace each runtime element back to
the configuration or code that implements it.

[![Pipecat MLX Voice deployment and security boundaries](docs/architecture/deployment-security.png)](docs/architecture/deployment-security.excalidraw)

[Open the editable Excalidraw scene](docs/architecture/deployment-security.excalidraw)
or the [scalable SVG render](docs/architecture/deployment-security.svg).

```text
iPhone browser
  │ HTTPS + verified identity (tailnet only)
  ▼
Tailscale userspace container ──► unprivileged Pipecat edge container
                                      │ bearer capability, three API routes
                                      ▼
                              reverse SSH forward
                                      │ host initiated
                                      ▼
macOS 127.0.0.1:9443 inference broker
  ├── MLX Whisper transcription
  ├── Ollama chat completion
  └── MLX Kokoro speech
```

There is no Funnel or public listener. “Internet access” means a WireGuard-encrypted connection
from a device signed into the allowed Tailscale account.

## Isolation properties

- The `pipecat-edge` libkrun VM has no macOS filesystem mounts. Podman's normal macOS home share is
  explicitly disabled by `deploy/podman-containers.conf`.
- Podman is rootless. Quadlet/systemd owns the pod and both containers.
- The edge app runs as UID 65532 with a read-only root, zero capabilities, `NoNewPrivs=1`, bounded
  CPU/memory/PIDs, and no Podman socket.
- Tailscale uses userspace networking: no `/dev/net/tun`, `NET_ADMIN`, privileged container, or
  published LAN port.
- macOS initiates an SSH reverse-forward. The guest cannot SSH back into the Mac.
- The bearer secret is a Podman secret. It authorizes only bounded STT, TTS, and exact-model chat
  routes; it cannot access files, sessions, tasks, Pi credentials, the database, or a generic proxy.
- Tailscale Serve supplies the login identity. The edge accepts only the configured exact user and
  browser origin.
- Remote agent dispatch is deliberately disabled on this isolated voice edge. The local task UI and
  Absurd/Pi worker remain separate until an independent trusted approval channel is added.

The VM is the security boundary. Containers add least privilege and reproducible lifecycle, but are
not treated as a substitute for the VM.

All external OCI inputs and the built edge are addressed by digest. Deployed Quadlets use
`Pull=never`, so a registry tag cannot silently change a running or restarted deployment. See
[HOST_REQUIREMENTS.md](HOST_REQUIREMENTS.md) for the complete host contract and update procedure.

## Installed layout

The deployment uses:

- Podman machine `pipecat-edge`: 4 CPUs, 4 GiB RAM, 24 GiB disk, libkrun, rootless
- `pipecat-edge.service`: browser and Pipecat WebSocket service
- `pipecat-tailscale.service`: tailnet-only HTTPS ingress
- macOS LaunchAgents: VM keepalive, loopback inference broker, and reverse SSH tunnel
- minimal background runtime: `~/Library/Application Support/PipecatEdge`

The background runtime receives only an inference-specific environment file. Database, Pi, task,
and session credentials are not copied into it.

## First-time setup

```bash
cd /Users/sathish.narayanan/Documents/git/agent-workload-platform/workloads/pipecat-mlx-voice
make setup
make pull-model
make host-preflight
make edge-create
make edge-install-services
make edge-provision
make edge-warm-models
```

Authorize the URL printed by `make edge-status`, then finish configuration:

```bash
make edge-login
```

`edge-login` derives the exact Tailscale login and MagicDNS HTTPS origin, writes them to the edge
allowlist, restarts the app, enables Tailscale Serve on 443, and prints the browser URL. It never
enables Funnel.

## Operations

```bash
make edge-status       # VM, containers, and Tailscale state
make edge-provision    # rebuild/redeploy after code changes
make edge-verify       # assert isolation and immutable-image invariants
make edge-cycle-test   # three provisions/restarts plus VM recovery
make edge-warm-models  # cache and exercise LLM, TTS, and STT end to end
make edge-login        # refresh identity/origin and Serve configuration
make check             # lint, type checks, tests, and browser production build
```

Expected host listeners are loopback only:

```bash
lsof -nP -iTCP:9443 -sTCP:LISTEN
curl -i http://127.0.0.1:9443/health   # must return 401 without the secret
```

Inside the VM, `127.0.0.1:9443` is the reverse-forwarded inference capability. No macOS directory
should appear in `mount`, and the edge app should have all-zero capability masks.

## Local task stack (not exposed by the edge)

The original local proposal workflow remains available through `make server`, `make worker`, and the
Postgres/Absurd targets. Voice can propose, browser approval uses a short-lived HMAC bound to the
identity and plan hash, and Pi tools run through the Gondolin extension. Do not connect these task
routes to the isolated edge without a separate approval factor that a compromised edge cannot forge.
