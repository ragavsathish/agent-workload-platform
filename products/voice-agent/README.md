# Voice Agent

A private browser voice interface for the Agent Workload Platform on Apple Silicon. Docker Compose
runs the browser-facing voice edge, Tailscale ingress, narrow task gateway, and Postgres. MLX,
Ollama, Pi, Gondolin, and Wassette remain native on macOS where Apple acceleration and VM-backed
tool isolation are available.

The [C4 architecture views](docs/architecture/README.md) include the deployment and security
boundaries as authoritative Mermaid sources.

## Product structure

This directory is the complete voice-agent product boundary. Deployable processes live in
`apps/`; reusable code lives in `packages/` only when multiple apps consume it:

- `apps/web/` is the browser application.
- `apps/edge/` is the containerized Pipecat/WebRTC voice edge.
- `apps/pi-agent/` owns the persistent Pi voice session and its Gondolin-isolated native tools.
- `apps/broker/` is the native MLX inference adapter exposed on host loopback.
- `apps/gateway/` is the containerized owner-facing task lifecycle API.
- `apps/worker/` consumes durable tasks and runs isolated Pi jobs.
- `packages/tasking/` owns shared task domain, application, persistence, and artifact code.
- `packages/telemetry/` owns the payload-free OpenTelemetry adapter shared by Python apps.
- `deploy/` owns Compose, macOS LaunchAgent, tailnet, secret-mount, and observability
  configuration; `scripts/` is the product lifecycle and verification surface.

The product vocabulary is defined in [GLOSSARY.md](GLOSSARY.md). Repository-wide
ownership and planned extractions are documented in
[Monorepo organization](../../docs/monorepo-organization.md).

## Trust model

- Tailscale Serve terminates trusted tailnet HTTPS and proxies HTTP and WebSocket traffic directly
  to Pipecat over shared loopback. Funnel and public Docker ports are not enabled.
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
- The Pi worker runs on macOS with built-in host tools disabled. Its explicit
  `gondolin_bash` tool runs inside a Gondolin micro-VM with only the immutable
  task workspace mounted at `/workspace`; browser and permission-scoped
  Wassette tools are additional capabilities.
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
make up
make login
make warm-models
```

`make login` performs interactive Tailscale authentication when needed, binds the exact login and
MagicDNS origin, enables the tailnet-only HTTPS proxy on port 443, and prints the browser URL.

## Browser URL

The current private deployment is available to authenticated devices in this
tailnet at:

<https://pipecat-edge.tailf6d713.ts.net>

The MagicDNS name and TLS certificate belong to the Tailscale node, so the URL
can remain configured while the application is unavailable. A `tailscale
serve status` result such as `proxy http://127.0.0.1:7860` proves only that the
HTTPS route exists. The `voice-edge` container must also be running in the same
network namespace and listening on port 7860.

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

Raw audio and synthesized speech exist only in memory while streaming. Transcripts remain in the
in-memory conversation context for the active call and are discarded with it. Postgres stores only
an explicitly proposed task instruction. Queue workers run Pi with `--no-session`, and native
launch services write stdout and stderr to `/dev/null`, so agent conversations are not retained as
Pi session JSONL. The synthetic black-box runner reports event counts, never transcript text.

The server-side microphone filter is selected with `VOICE_INPUT_FILTER=rnnoise|voxlock`; RNNoise
is the rollback default. VoxLock uses the host WAV named by `VOXLOCK_VOICE_SAMPLE_SOURCE`.
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
<https://pipecat-edge.tailf6d713.ts.net:8443>; Grafana trusts only the identity header injected by
the Tailscale proxy and does not ask for another password. Direct Mac-loopback access at
<http://127.0.0.1:3300> still requires user `admin`; obtain its generated password with
`make grafana-password`. The provisioned **Pipecat Voice Overview** dashboard shows operation rates,
p95 durations, errors, and recent traces for the voice edge, gateway, and native MLX inference
broker.

Grafana and OTLP/HTTP bind only to Mac loopback. OTLP/gRPC, Prometheus, Tempo, and Loki ports are not
published. Application and bundle Docker logs remain disabled, and applications do not send the
OpenTelemetry logs signal. Telemetry is stored in the `otel-lgtm-data` Docker volume; Prometheus
retention is seven days. This all-in-one bundle is for private local monitoring, not production.

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
reusable skills are mounted there read-only. It disables discovered host extensions, prompt
templates, themes, and context files. Kokoro speaks the final text produced by Pi after any tool
calls complete. `PI_VOICE_MODEL` selects the model; when blank, Pi uses its configured default.

See [BENCHMARKS.md](BENCHMARKS.md) for the measured M4 Pro CPU, unified-memory, LLM throughput,
and speech realtime factors, plus the reproducible benchmark command.

See [HOST_REQUIREMENTS.md](HOST_REQUIREMENTS.md) for the host contract and
[docs/architecture](docs/architecture/README.md) for responsibility and threat-boundary details.
