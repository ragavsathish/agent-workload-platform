# Host requirements

## Hardware and software

- Apple Silicon Mac, macOS 14 or newer
- 8 GiB RAM minimum; 16 GiB recommended
- 15 GiB free disk minimum for `make host-preflight`; 40 GiB recommended for images,
  telemetry, and model caches
- Docker Desktop with Docker Compose
- uv with Python 3.13 (and Python 3.12 for ACE-Step), Node.js/npm, Rust/Cargo,
  Ollama, FFmpeg/FFprobe, curl, and Homebrew `libpq` and `fluent-bit`
- Pi, Wassette, the repository's built Gondolin agent extension, and any approved Wassette components
- A Tailscale account shared with the browser device

Kubernetes, k3s, Lima, Podman, Quadlet, systemd, SSH forwarding, and Tailscale Funnel are not used.
Run `make host-preflight` for executable checks.

## Host configuration

Create `deploy/.env` from the example. Generate distinct random values for
`INFERENCE_BROKER_TOKEN`, `AGENT_GATEWAY_TOKEN`, `ORCHESTRATOR_APPROVAL_SECRET`, and
`POSTGRES_PASSWORD`. `make up` generates and preserves a separate Grafana admin password unless
`GRAFANA_ADMIN_PASSWORD` is set. Configure the exact allowed Ollama model, MLX models, logical workspaces, Pi
binary, Pi model credentials, Gondolin extension, and Wassette permissions.

Native LaunchAgents use separate, least-privilege files under
`deploy/host-env/`. `make setup` initializes missing files from
`deploy/host-env.example/`; replace their placeholder credentials before
installation. Ansible copies them with mode `0600`, and dotenvx injects each
file only into its owning process.

Set `VOICE_DEFAULT_WORKSPACE` to one name in `ORCHESTRATOR_ALLOWED_WORKSPACES`; spoken
commands can then say “the default workspace” without asking speech recognition to reconstruct a
filesystem path. To authorize a new logical workspace, add its exact lowercase name to
`ORCHESTRATOR_ALLOWED_WORKSPACES`, then publish its committed Git state with
`make publish-workspace WORKSPACE_ID=sdft-confsft-methods-paper REPOSITORY=/path/to/repository`.
The publisher rejects names outside that explicit allowlist before writing artifacts, and task
resolution rejects an allowlisted name until its immutable bundle pointer exists in loopback-only
S3Mock. Refresh Pi's provider subscription/login before enabling approvals. A stale login is
recorded as a durable failed task rather than falling back to an unapproved provider.

The worker does not require Documents, Desktop, or Downloads access. Scratch workspaces live under
`~/.local/share/agent-workload-platform/workspaces` with mode `0700` and are removed after every
task. Publishing a repository is an explicit interactive action; only that invoking terminal needs
access when the source happens to be under a macOS privacy-protected folder.

`make install-host-services` builds and installs the Rust Pi task RPC supervisor,
copies the generic Gondolin extension into
`~/Library/Application Support/PipecatEdge/gondolin-agent`, the product-owned Pi
Voice Service into `voice-pi-agent`, and the pinned VM image into
`gondolin-assets`. It also installs pinned ACE-Step 1.5 under
`PipecatEdge/apps/music-generation` and starts its loopback API. The LaunchAgents
never load executable code or VM assets from
`~/Documents`, so they do not need Full Disk Access or Documents-folder
permission.

`make up` derives root-only Compose secret files under ignored `deploy/secrets/`; no secret is baked
into an image. It installs eight LaunchAgents in `~/Library/LaunchAgents`:

- inference broker: local Parakeet v3 MLX, Ollama, and Kokoro capability on `127.0.0.1:9443`;
- music generation: ACE-Step audio and language models on `127.0.0.1:8001`;
- digital-twin classifier and listener: local extraction/classification inference
  and journal capture;
- host observability: macOS and registered Gondolin VM metrics on `127.0.0.1:2022` and `:9465`;
- image builder: trusted Gitea workflow supplies a build context from an isolated Gondolin VM to the host Docker API; image archives stay in a local host handoff folder;
- Pi Voice Service: persistent owner conversation, Gondolin-isolated native tools, and deferred
  host-side Wassette MCP tools on `127.0.0.1:9446`;
- Pi worker: consumes approved tasks from Postgres and invokes Gondolin/Wassette and the
  installed Pi task RPC supervisor.

The worker routes Pi's standard `read`, `write`, `edit`, and `bash` tools
through the micro-VM with only the immutable task workspace mounted at
`/workspace`; they never fall back to host operations. Results about disks,
processes, or the operating system therefore describe that isolated workload,
not macOS.

The voice orchestrator starts Wassette as an MCP stdio subprocess only when its Pi session is
created. Wassette components are separate from Gondolin: they receive no orchestrator credentials,
start without host capabilities, and must be granted only the minimum filesystem, network, or
environment access required for the selected component. The private component cache lives under
`~/Library/Application Support/PipecatEdge/wassette-components`.

The Compose gateway receives the database and approval secrets. The voice edge receives only the
broker and gateway bearer tokens. Tailscale state and Postgres data use named Docker volumes.
S3Mock artifacts use another named volume inside Docker Desktop and never bind-mount a host folder.
Rootless Gitea also uses named volumes and receives a committed repository mirror during `make up`;
it does not bind-mount a host repository. The persistent voice VM contains AWS CLI and Git and may
reach only allowlisted synthetic S3Mock, Gitea, Prometheus, and Oxigraph origins. A host network hook
rewrites those origins to their configured loopback endpoints; direct VM internet access remains denied.
The Oxigraph CLI permits raw RDF queries and updates inside that VM; this is an intentional
single-owner capability, not a bounded personal-knowledge API. The mock credentials do
not grant access to real AWS S3. The VM's checksum-pinned Tea client receives only a restricted,
public-read token; it never receives the Gitea publisher credential.

## Network contract

| Address | Owner | Purpose |
|---|---|---|
| tailnet HTTPS 443 | Tailscale Serve | owner-only HTTPS; `/`, `/metrics/`, `/git/`, and `/queue/` only |
| host loopback `127.0.0.1:8080` | Traefik local-test ingress | browser tests without Tailscale; enabled only when `EDGE_ALLOW_LOCAL_INGRESS=true` |
| shared Tailscale/Traefik loopback | Traefik and Pipecat voice edge | exact-owner forward-auth and browser UI behind Serve |
| `127.0.0.1:54329` | Docker Postgres | native Pi worker queue access |
| `127.0.0.1:9090` | Docker S3Mock | native worker immutable inputs and task result artifacts |
| `127.0.0.1:3001` | Docker Gitea | committed source mirror; anonymous read, bootstrap publisher writes |
| `127.0.0.1:3300` | Docker Grafana | authenticated local metrics and traces UI |
| `127.0.0.1:4318` | Docker OTel collector | OTLP/HTTP from the native MLX broker |
| `127.0.0.1:9091` | Docker Prometheus | local metrics queries for the voice VM |
| `127.0.0.1:8000` | Docker Grafana MCP | authenticated read-only dashboards and traces |
| `127.0.0.1:9444` | Docker Agent Gateway | bearer-protected task, song, and personal-knowledge API |
| `127.0.0.1:7878` | Docker Oxigraph | private RDF query and update endpoint |
| `127.0.0.1:9443` | native inference broker | authenticated STT, dialogue, and TTS |
| `127.0.0.1:9446` | native Pi Voice Service | authenticated conversation backend |
| `127.0.0.1:8001` | native ACE-Step | music render API and model health |
| `127.0.0.1:11434` | Ollama | local exact-model inference |

The gateway is also published on host loopback for the native worker and Pi Voice Service, but it
has no LAN or tailnet route. The voice/Tailscale network namespace publishes only the local-test
ingress on host loopback. Docker Desktop may reach host loopback through its host
gateway. Compose assigns the dedicated `inference-broker` alias because Tailscale can also
synthesize an IPv6 answer for `host.docker.internal`; the random broker capability and exact
route/model limits are therefore part of the security boundary.

The `otel-lgtm` bundle is connected to the private control network. Grafana, Prometheus, and
OTLP/HTTP are published only on loopback; collector and datastore ports are not exposed to the LAN
or tailnet.
Fluent Bit collects aggregate Docker Desktop VM system metrics through read-only `/proc` and `/sys`
mounts and exports them only on an internal Compose monitoring network. It has no Docker socket and
publishes no host port. Homebrew Fluent Bit is also required on macOS. The host-observability
LaunchAgent exposes macOS node metrics on `127.0.0.1:2022` and host-side Gondolin QEMU runner metrics
on `127.0.0.1:9465`; both are scraped through Docker's host gateway and are unavailable on the LAN.
VM owners register only an opaque VM ID, role label, QEMU PID, and configured limits in the private
runtime directory. No guest agent or telemetry credential is installed in a Gondolin VM.
Telemetry deliberately excludes logs and all user-controlled values. Its named volume contains
only operation metrics and sanitized traces and can be removed separately if local telemetry must
be erased. Tailscale Serve exposes Grafana at `/metrics/` on the single tailnet HTTPS origin and
injects the authenticated login; Traefik accepts only shared-loopback traffic whose login matches
the configured owner through the edge forward-auth endpoint,
and Grafana accepts it only from the fixed Tailscale container IP. Direct loopback access continues
to require the generated Grafana admin password.

Absurd Habitat is reachable only through `/queue/`; it has no published host port. It connects to
Postgres over the private data network with a dedicated operator role limited to the Absurd queue
schema. That role can inspect and operate durable queue state but cannot read task proposals.

The phone must run Tailscale and join the same tailnet. The tailnet policy must grant only the owner
access to the voice node on TCP 443; use `deploy/tailscale-policy.hujson.example` as the minimum
policy. Tailscale Serve terminates trusted HTTPS, strips client-supplied Tailscale identity headers,
adds the authenticated tailnet identity, and forwards over shared loopback to Traefik. Traefik
requires the exact configured owner before routing `/` to Pipecat, `/metrics/` to Grafana, `/git/`
to Gitea, or `/queue/` to Habitat.
The application requires the exact MagicDNS origin and a signed,
one-use WebSocket path token. This is a single-user deployment: `make login` pins exactly one owner
login, and tailnet ACLs authenticate the devices allowed to reach it. There is no fallback listener
on the local Wi-Fi interface.

## Repeatability and updates

Images use pinned upstream digests, Python dependencies use uv lockfiles, and the browser uses its
npm lockfile. `make cycle-test` recreates the stack three times, re-runs schema convergence, checks
persistent state, and leaves the verified stack running. Updates are intentional: review digest or
lockfile changes, run `make check`, then `make up` and `make cycle-test`.

`make down` preserves data. Removing the `pipecat-mlx-voice_postgres-data` or
`pipecat-mlx-voice_tailscale-state` volume is destructive and is intentionally not wrapped by a
Make target.
