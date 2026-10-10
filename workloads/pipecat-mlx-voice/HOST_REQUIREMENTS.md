# Host requirements

## Hardware and software

- Apple Silicon Mac, macOS 14 or newer
- 8 GiB RAM minimum; 16 GiB recommended
- 15 GiB free disk minimum; 35 GiB recommended for images and model caches
- Docker Desktop with Docker Compose
- uv with Python 3.13, Node.js/npm, Ollama, curl, and Homebrew `libpq`
- Pi plus the repository's built Gondolin browser extension and any approved Wassette components
- A Tailscale account shared with the browser device

Kubernetes, k3s, Lima, Podman, Quadlet, systemd, SSH forwarding, and Tailscale Funnel are not used.
Run `make host-preflight` for executable checks.

## Host configuration

Create `server/.env` from the example. Generate distinct random values for
`INFERENCE_BROKER_TOKEN`, `AGENT_GATEWAY_TOKEN`, `ORCHESTRATOR_APPROVAL_SECRET`, and
`POSTGRES_PASSWORD`. Configure the exact allowed Ollama model, MLX models, workspace roots, Pi
binary, Pi model credentials, Gondolin extension, and Wassette permissions.

Set `VOICE_DEFAULT_WORKSPACE` to one exact project below `ORCHESTRATOR_WORKSPACE_ROOTS`; spoken
commands can then say “the default workspace” without asking speech recognition to reconstruct a
filesystem path. Refresh Pi's provider subscription/login before enabling approvals. A stale login
is recorded as a durable failed task rather than falling back to an unapproved provider.

macOS protects `~/Documents`, `~/Desktop`, and similar locations from background LaunchAgents. If
an allowed workspace is under one of those folders, grant Full Disk Access/Files and Folders access
to the native worker chain (`host-worker.sh`, `uv`, Python, Node, and Pi), or place agent workspaces
under an unprotected dedicated directory. Without that grant, a background Pi process can stall
while resolving its working directory; the queue timeout remains the final containment.

`make up` derives root-only Compose secret files under ignored `deploy/secrets/`; no secret is baked
into an image. It also installs two LaunchAgents in `~/Library/Application Support/PipecatEdge`:

- inference broker: local MLX Whisper, Ollama, and Kokoro capability on `127.0.0.1:9443`;
- Pi worker: consumes approved tasks from Postgres and invokes Gondolin/Wassette.

The Compose gateway receives the database and approval secrets. The voice edge receives only the
broker and gateway bearer tokens. Tailscale state and Postgres data use named Docker volumes.

## Network contract

| Address | Owner | Purpose |
|---|---|---|
| tailnet HTTPS 443 | Tailscale userspace container | browser UI and WebSocket audio |
| `127.0.0.1:54329` | Docker Postgres | native Pi worker queue access |
| `127.0.0.1:9443` | native inference broker | authenticated STT, dialogue, and TTS |
| `127.0.0.1:11434` | Ollama | local exact-model inference |

The agent gateway is reachable only on Compose's private networks. The voice/Tailscale network
namespace publishes no Docker port. Docker Desktop may reach host loopback through its host
gateway. Compose assigns the dedicated `inference-broker` alias because Tailscale can also
synthesize an IPv6 answer for `host.docker.internal`; the random broker capability and exact
route/model limits are therefore part of the security boundary.

## Repeatability and updates

Images use pinned upstream digests, Python dependencies use uv lockfiles, and the browser uses its
npm lockfile. `make cycle-test` recreates the stack three times, re-runs schema convergence, checks
persistent state, and leaves the verified stack running. Updates are intentional: review digest or
lockfile changes, run `make check`, then `make up` and `make cycle-test`.

`make down` preserves data. Removing the `pipecat-mlx-voice_postgres-data` or
`pipecat-mlx-voice_tailscale-state` volume is destructive and is intentionally not wrapped by a
Make target.
