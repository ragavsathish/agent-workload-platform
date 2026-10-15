# Voice Agent

A private browser voice interface for the Agent Workload Platform on Apple Silicon. Docker Compose
runs the browser-facing voice edge, Tailscale ingress, narrow task gateway, and Postgres. MLX,
Ollama, Pi, Gondolin, and Wassette remain native on macOS where Apple acceleration and VM-backed
tool isolation are available.

The [C4 architecture views](docs/architecture/README.md) include the deployment and security
boundaries as authoritative Mermaid sources.

## Product structure

Deployable processes live in `apps/`. Code shared by multiple apps lives in `packages/`.

```text
apps/       web, edge, pi-agent, broker, gateway, worker
packages/   tasking, telemetry
deploy/     Compose, macOS services, Tailscale, secrets, observability
scripts/    setup, operation, and verification
tests/      end-to-end probes
docs/       product architecture
```

The product vocabulary is defined in [GLOSSARY.md](GLOSSARY.md). Repository-wide
ownership and planned extractions are documented in
[Monorepo organization](../../docs/monorepo-organization.md).

## Trust model

- Tailscale Serve terminates trusted tailnet HTTPS, enforces tailnet access, strips spoofed
  identity headers, and injects the authenticated login before forwarding to Traefik over shared
  loopback. Before routing, Traefik asks the edge to match that login against the configured owner.
  It routes `/` to Pipecat, `/metrics/` to Grafana, `/git/` to Gitea, and `/queue/` to the
  upstream Absurd Habitat operator UI. Funnel and public Docker ports are not enabled.
- Browser sessions require an exact HTTPS origin and a signed, one-use token in the WebSocket path.
  The current deployment is deliberately single-user: login pins exactly one owner identity during
  setup, while tailnet ACLs authenticate which devices can reach the listener.
- The voice edge is non-root, read-only, capability-free, resource-bounded, and has no host mount or
  Docker socket.
- Separate bearer capabilities expose only bounded inference and propose/status/approve/cancel.
- Voice edge and gateway containers use Docker's `none` log driver; Pipecat's shared Loguru handler
  is removed so transcripts, LLM context, and audio-adjacent payloads are never formatted as logs.
- OpenTelemetry exports only manually defined, low-cardinality operation counts, durations, and
  traces. It has no log exporter and records no audio, text, identity, workspace, proposal ID,
  exception message, URL parameter, request body, or response body.
- Database credentials, Pi/provider authentication, sessions, and writable workspaces never enter the voice
  container.
- The Pi worker runs on macOS, but Pi's standard `read`, `write`, `edit`, and
  `bash` tools are backed by a Gondolin micro-VM with only the immutable task
  workspace mounted at `/workspace`; browser and permission-scoped Wassette
  tools are additional capabilities.
- Durable delegation is deliberately **YOLO voice submission** for now: the Pi
  Voice Service may create and immediately queue a task when the owner asks for
  asynchronous work. A separately created proposal still requires a later
  explicit approval turn. The gateway binds approvals to identity, proposal,
  plan hash, and expiry. This is convenient, not phishing-resistant; a UI or
  Face ID/WebAuthn capability should replace the side-effect boundary later.

Docker Desktop's Linux VM is the voice-service isolation boundary. Its containers share that VM,
so this is intentionally simpler and weaker than a dedicated per-service micro-VM. The risky agent
tools still execute through Gondolin rather than in the voice stack.

## Start

```bash
cd products/voice-agent
make setup
# Fill deploy/.env using deploy/.env.example, including fresh random secrets.
make pull-model
make host-preflight
make start
make login
make warm-models
```

`make start` deploys in the background. Use `make up` to deploy and then follow
bounded container output together with the native broker, Pi voice, and worker
stdout; `Ctrl-C` stops following output but leaves the services running. Use
`make logs` to follow an already-running deployment.

`make login` performs interactive Tailscale authentication when needed, binds the exact login and
MagicDNS origin, enables one tailnet-only HTTPS origin on port 443, and prints the voice, metrics,
Git, and durable-queue URLs.

## Browser URL

The current private deployment is available to authenticated devices in this
tailnet at:

<https://pipecat-edge.tailf6d713.ts.net>

The MagicDNS name and TLS certificate belong to the Tailscale node, so the URL
can remain configured while the application is unavailable. A `tailscale
serve status` result such as `proxy http://127.0.0.1:8080` proves only that the
HTTPS route exists. The `voice-edge` container must also be running in the same
network namespace and listening on port 7860, and Traefik must be listening on port 8080.

Check the complete path with:

```bash
make status
docker exec pipecat-mlx-voice-tailscale-1 tailscale serve status
```

If the proxy exists but the page does not open, use `make up`, wait for
`voice-edge`, `agent-gateway`, Postgres, and S3Mock to become healthy, and then
run `make verify`. Open the URL from a device connected to the same tailnet;
the Mac's ordinary DNS resolver does not need to resolve the private MagicDNS
name when the Mac itself is not connected as a Tailscale client.

## Operate

```bash
make status       # Compose services, tailnet state, native service state
make start        # deploy, verify, and return after services become healthy
make up           # deploy, verify, and follow service stdout
make logs         # follow container and native-service stdout
make verify       # isolation, capabilities, ingress, broker, and gateway checks
make grafana-password # print the local Grafana credential after make up
make recreate     # immutable container recreation plus verification
make cycle-test   # three stop/recreate/schema cycles plus final recovery
make benchmark-mlx # warm CPU, RSS, tokens/s, and realtime-factor benchmark
make publish-workspace WORKSPACE_ID=agent-workload-platform REPOSITORY=/path/to/repository
make blackbox-voice UTTERANCE="Propose a task in the default workspace to inspect it"
make blackbox-e2e # synthetic voice through Pipecat plus a Postgres assertion
make down         # stop Compose services; preserve Postgres and Tailscale volumes
make check        # tests, lint, type checks, build, Compose and plist validation
```

Postgres and S3Mock are published only on host loopback so the native Pi worker can consume the
queue and immutable workspace bundles. The bearer-protected agent gateway is also published on
host loopback so the optional Pi voice backend can use only its four task-lifecycle operations.
The native inference broker listens on `127.0.0.1:9443`; Docker Desktop makes that protected
capability available through the private `inference-broker` host-gateway alias. No service listens
on the Mac LAN interface; browser access is available only through the tailnet listener.

S3Mock stores committed Git bundles and result patches in a Docker named volume; it never
bind-mounts `~/Documents`. Each task verifies the bundle digest, expands it beneath
`~/.local/share/agent-workload-platform/workspaces`, uploads its patch/status/result, and deletes
the scratch directory. The mock validates the local artifact contract, not production IAM or
durability; swap its endpoint for a real S3-compatible service before relying on those guarantees.

Raw microphone input and the VoxLock/RNNoise comparison outputs are retained as WAV files for the
five most recent completed conversations in the private `voice-diagnostics` Docker volume. The
tailnet-authenticated **Replays** page exposes all three versions for listening; the oldest session
is deleted after the sixth completes. Recording stops at `VOICE_DIAGNOSTIC_MAX_SECONDS` per session,
and audio is never exported to OpenTelemetry. The same page uses WaveSurfer for replay waveforms
and raw/VoxLock spectrograms, and Recharts for input/output energy, suppression, per-filter
latency, LSTM-state activity, and the model's predicted complex-mask magnitude. The edge image
instruments the digest-verified VoxLock ONNX graph at build time to expose that mask; it records
only frequency-band aggregates, not model tensors. The live view polls a bounded microphone
envelope rather than sending replayable audio samples. Synthesized speech exists only in memory while
streaming. Transcripts remain in the in-memory conversation context for the active call and are
discarded with it. Postgres stores only an explicitly proposed task instruction. Queue workers run Pi
with `--no-session`, and native
launch services write stdout and stderr to `/dev/null`, so agent conversations are not retained as
Pi session JSONL. The synthetic black-box runner reports event counts, never transcript text.

The server-side microphone filter is selected with `VOICE_INPUT_FILTER=rnnoise|voxlock`; RNNoise
is the rollback default. Both filters process the same input so their last-five replay files are
directly comparable, while only the selected filter continues to VAD and transcription. VoxLock
uses the host WAV named by `VOXLOCK_VOICE_SAMPLE_SOURCE`.
`make up` validates mono 16 kHz PCM16 input, extracts the strongest three seconds from its first
15 seconds, and writes only that derived sample to an ignored mode-0600 Compose secret. The edge
loads hash-verified ONNX models baked into its image and runs with Hugging Face networking disabled.
VoxLock is target-speaker isolation, not authentication or liveness detection. See the
[VoxLock implementation and validation guide](../../docs/research/voxlock-pipecat-integration.md).
Silero VAD keeps Pipecat's recommended `stop_secs=0.2`; `LocalSmartTurnAnalyzerV3` decides when a
spoken turn is complete. MLX Whisper receives every completed audio segment directly—there is no
speaker-authentication gate. The selected input filter runs before VAD and transcription.
Payload-free metrics distinguish accepted audio, emitted or empty
transcripts, Smart Turn inference triggers, completed turns, and stop timeouts without exporting
audio or transcript text.

## Local observability

The pinned `grafana/otel-lgtm` development bundle provides Grafana, Prometheus, Tempo, and an OTLP
collector. From an authenticated tailnet device, open
<https://pipecat-edge.tailf6d713.ts.net/metrics/>; Grafana trusts only the identity header injected
by Tailscale through the localhost-only Traefik ingress and does not ask for another password.
Direct Mac-loopback access at
<http://127.0.0.1:3300> still requires user `admin`; obtain its generated password with
`make grafana-password`. The provisioned **Voice Product Health** dashboard follows the product
journey from detected speech through transcript, Pi inference, and reply audio. It also shows turn
outcomes, voice-filter pass rate, user-perceived and inference-stage latency, task activity,
failures, and recent payload-free traces.

The provisioned **Platform Resources** dashboard separates three resource layers: the physical Mac,
the Docker Desktop Linux VM, and each running Gondolin QEMU runner. Native Fluent Bit reports macOS
CPU, active+wired memory, load, disk, and network metrics. The Compose Fluent Bit instance reads the
Docker VM's `/proc` and `/sys` read-only. A small loopback-only host exporter reports CPU, resident
memory, uptime, and configured limits for every registered voice or task Gondolin VM. It exports no
process command lines, guest data, audio, or transcript content.

CPU busy is average non-idle time across a system's logical CPUs. Docker memory uses `MemAvailable`;
the Mac panel uses active plus wired memory and is deliberately labelled as an approximation, not
Apple's Memory Pressure indicator. Load per CPU near 100% means roughly one runnable job per logical
CPU; a sustained higher value means work is queueing. Disk and network panels are throughput, not
latency. A Gondolin VM's resident memory is the host QEMU process RSS, not guest-visible used memory.
Task VMs appear only while a task is executing.

Mac and Docker measurements are nested: Docker activity is already part of the physical Mac total,
so never add those lines together. Similarly, use the product dashboard and traces to correlate a
resource spike with a voice operation rather than attributing every system-wide spike to voice.
Both native endpoints bind only to Mac loopback; OTel reaches them through Docker's host gateway.

The upstream Absurd **Habitat** operator UI is available at
<https://pipecat-edge.tailf6d713.ts.net/queue/>. It reads queue, task, run, event, and checkpoint
state directly from Postgres and can perform native queue operations such as retry. Habitat has no
published Docker port and receives a separate `habitat_operator` credential whose grants are
limited to the Absurd schema; it cannot read voice task proposals. This operational view does not
replace the gateway's proposal, approval, or tenant-policy boundary.

Grafana and OTLP/HTTP bind only to Mac loopback. OTLP/gRPC, Prometheus, Tempo, and Loki ports are not
published. Gateway and edge stdout is retained only in bounded local Docker logs for `make logs`;
applications do not send the OpenTelemetry logs signal. Telemetry is stored in the
`otel-lgtm-data` Docker volume; Prometheus retention is seven days. This all-in-one bundle is for
private local monitoring, not production.

The same authenticated origin serves the voice UI at `/`, the committed source mirror at `/git/`,
and Habitat at `/queue/`. Tailscale authenticates the connection and strips spoofed identity
headers; Traefik then uses the edge's forward-auth endpoint to require the exact configured owner
before any route is served. Prometheus, OTLP, the Agent Gateway, S3Mock, Postgres, and the Traefik
dashboard have no tailnet route.

The black-box runner synthesizes speech with Kokoro, streams it through the same authenticated
WebSocket used by the browser, transcribes it with MLX Whisper, and exercises the LLM/tool path.
Before Tailscale login it uses `deploy/compose.local-test.yml` as a non-listening network anchor;
set `BLACKBOX_USE_TAILSCALE=true` to test an authenticated tunnel namespace. See
[TESTING.md](TESTING.md) for assertions and failure interpretation.

Set `VOICE_LLM_BACKEND=pi` in `apps/edge/.env` to select the alternate
`Whisper -> Pi agent -> restricted Pi task tools -> Kokoro` path. The default remains `ollama`.
Pi voice uses a dedicated long-running Node service built on Pi's `createAgentSession()` SDK. The
service keeps conversation state between turns, reconciles a restarted or reset Pipecat transcript,
and owns the product's proposal, submission, status, approval, and cancellation tools. Its native
read, write, edit, and bash operations run only inside the persistent Gondolin Voice Workspace;
reusable skills are mounted read-only at `/skills`. Committed source is published to the private,
loopback-only Gitea service during `make start`; the VM may anonymously clone that public-in-Gitea
mirror into `/workspace`, but receives no publisher credential. No host Git directory is mounted, so
ignored files, local secrets, and uncommitted changes are not exposed. It disables discovered
host extensions, prompt templates, themes, and context files. Kokoro speaks the final text produced
by Pi after any tool calls complete. `PI_VOICE_MODEL` selects the model; when blank, Pi uses its
configured default. The VM image includes AWS CLI and receives mock-only credentials plus a
synthetic `S3_ENDPOINT_URL`. Gondolin denies general egress and rewrites only that synthetic origin
to loopback-published S3Mock, allowing Pi to inspect `s3://$S3_BUCKET` without general network
access.

Gitea uses rootless mode, SQLite, and named Docker volumes. Registration, SSH, Actions, and packages
are disabled. `scripts/gitea-sync.sh` creates the publisher account and repository idempotently, then
mirrors only committed refs from this repository. Gitea is reachable from macOS only on
`http://127.0.0.1:3001`; Gondolin can reach only its synthetic read endpoint and S3Mock, with all
other VM network destinations denied.

The VM image includes the checksum-verified `tea` CLI. Deployment provisions a separate restricted
`voice-agent` account and a
`public-only,read:repository,read:issue,read:user,read:organization` token. The persistent
VM configures that token as Tea login `local`; it cannot publish code or mutate issues and pull
requests. The deployment-only `source-publisher` credential never enters the VM.

See [BENCHMARKS.md](BENCHMARKS.md) for the measured M4 Pro CPU, unified-memory, LLM throughput,
and speech realtime factors, plus the reproducible benchmark command.

See [HOST_REQUIREMENTS.md](HOST_REQUIREMENTS.md) for the host contract and
[docs/architecture](docs/architecture/README.md) for responsibility and threat-boundary details.
