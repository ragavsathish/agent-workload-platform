# Host requirements

## Hardware and software

- Apple Silicon Mac, macOS 14 or newer
- 8 GiB RAM minimum; 16 GiB recommended
- 20 GiB free disk minimum; 40 GiB recommended for images, telemetry, and model caches
- Docker Desktop with Docker Compose
- uv with Python 3.13, Node.js/npm, Ollama, curl, and Homebrew `libpq`
- Pi plus the repository's built Gondolin browser extension and any approved Wassette components
- A Tailscale account shared with the browser device

Kubernetes, k3s, Lima, Podman, Quadlet, systemd, SSH forwarding, and Tailscale Funnel are not used.
Run `make host-preflight` for executable checks.

## Host configuration

Create `server/.env` from the example. Generate distinct random values for
`INFERENCE_BROKER_TOKEN`, `AGENT_GATEWAY_TOKEN`, `ORCHESTRATOR_APPROVAL_SECRET`, and
`POSTGRES_PASSWORD`. `make up` generates and preserves a separate Grafana admin password unless
`GRAFANA_ADMIN_PASSWORD` is set. Configure the exact allowed Ollama model, MLX models, logical workspaces, Pi
binary, Pi model credentials, Gondolin extension, and Wassette permissions.

Set `VOICE_DEFAULT_WORKSPACE` to one name in `ORCHESTRATOR_ALLOWED_WORKSPACES`; spoken
commands can then say “the default workspace” without asking speech recognition to reconstruct a
filesystem path. Publish its committed Git state with `make publish-workspace`; the native worker
downloads that immutable bundle from loopback-only S3Mock. Refresh Pi's provider subscription/login
before enabling approvals. A stale login is recorded as a durable failed task rather than falling
back to an unapproved provider.

The worker does not require Documents, Desktop, or Downloads access. Scratch workspaces live under
`~/.local/share/agent-workload-platform/workspaces` with mode `0700` and are removed after every
task. Publishing a repository is an explicit interactive action; only that invoking terminal needs
access when the source happens to be under a macOS privacy-protected folder.

`make up` derives root-only Compose secret files under ignored `deploy/secrets/`; no secret is baked
into an image. It also installs two LaunchAgents in `~/Library/Application Support/PipecatEdge`:

- inference broker: local MLX Whisper, Ollama, and Kokoro capability on `127.0.0.1:9443`;
- Pi worker: consumes approved tasks from Postgres and invokes Gondolin/Wassette.

The Compose gateway receives the database and approval secrets. The voice edge receives only the
broker and gateway bearer tokens. Tailscale state and Postgres data use named Docker volumes.
S3Mock artifacts use another named volume inside Docker Desktop and never bind-mount a host folder.

## Network contract

| Address | Owner | Purpose |
|---|---|---|
| tailnet HTTPS 443 | Tailscale userspace container | browser UI and WebSocket audio |
| private Wi-Fi IP `:8443` | opt-in Caddy LAN proxy | HTTPS browser UI and WebSocket audio |
| `127.0.0.1:54329` | Docker Postgres | native Pi worker queue access |
| `127.0.0.1:9090` | Docker S3Mock | native worker immutable inputs and task result artifacts |
| `127.0.0.1:3300` | Docker Grafana | authenticated local metrics and traces UI |
| `127.0.0.1:4318` | Docker OTel collector | OTLP/HTTP from the native MLX broker |
| `127.0.0.1:9443` | native inference broker | authenticated STT, dialogue, and TTS |
| `127.0.0.1:11434` | Ollama | local exact-model inference |

The agent gateway is reachable only on Compose's private networks. The voice/Tailscale network
namespace publishes no Docker port. Docker Desktop may reach host loopback through its host
gateway. Compose assigns the dedicated `inference-broker` alias because Tailscale can also
synthesize an IPv6 answer for `host.docker.internal`; the random broker capability and exact
route/model limits are therefore part of the security boundary.

The `otel-lgtm` bundle is connected to the private control network. Only Grafana and OTLP/HTTP are
published, both on loopback; collector and datastore ports are not exposed to the LAN or tailnet.
Telemetry deliberately excludes logs and all user-controlled values. Its named volume contains
only operation metrics and sanitized traces and can be removed separately if local telemetry must
be erased.

LAN mode is opt-in and binds only the detected RFC1918 Wi-Fi address, never `0.0.0.0`. Caddy keeps
its local CA private key in a Docker named volume and emits no access log; only the public root
certificate is copied to ignored `deploy/lan-client/` for AirDrop. A generated HTTP Basic password
guards both the page and WebSocket; after authentication Caddy injects the single allowlisted local
identity. iOS must install the profile and
enable full trust before Safari treats the page as a secure microphone context. `make lan-down`
removes the listener and restores the voice process to its tailnet-only loopback binding.

## Repeatability and updates

Images use pinned upstream digests, Python dependencies use uv lockfiles, and the browser uses its
npm lockfile. `make cycle-test` recreates the stack three times, re-runs schema convergence, checks
persistent state, and leaves the verified stack running. Updates are intentional: review digest or
lockfile changes, run `make check`, then `make up` and `make cycle-test`.

`make down` preserves data. Removing the `pipecat-mlx-voice_postgres-data` or
`pipecat-mlx-voice_tailscale-state` volume is destructive and is intentionally not wrapped by a
Make target.
