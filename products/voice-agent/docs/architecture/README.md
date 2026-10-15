# Voice Agent architecture

Audience: maintainers, reviewers, and operators of the Voice Agent product.

The Mermaid architecture files are the parseable source of truth. Rendered PNG files are generated
views and must not be edited by hand. C4 boundaries and terminology define the static views; sequence
notation is used for runtime views because it preserves order without crossing relationship labels.

| View | Question answered | Source | Render |
|---|---|---|---|
| C1 system context | Who uses the Voice Agent and which external systems does it depend on? | [c1-system-context.mmd](c1-system-context.mmd) | [PNG](c1-system-context.png) |
| C2 containers | Which independently running parts own voice, Pi, task, artifact, and telemetry responsibilities? | [c2-container.mmd](c2-container.mmd) | [PNG](c2-container.png) |
| C3 Browser Client | Which UI components own conversation control, diagrams, tasks, transcript, and diagnostics? | [c3-browser-client.mmd](c3-browser-client.mmd) | [PNG](c3-browser-client.png) |
| C3 Voice Edge | How does Pipecat turn browser audio into an authenticated, observable voice pipeline? | [c3-voice-edge.mmd](c3-voice-edge.mmd) | [PNG](c3-voice-edge.png) |
| C3 Inference Broker | Which narrow adapters expose native STT, TTS, Pi streaming, context, and fallback inference? | [c3-inference-broker.mmd](c3-inference-broker.mmd) | [PNG](c3-inference-broker.png) |
| C3 Pi Voice Service | How are persistent Pi turns, tools, transcript, context, skills, and the voice VM coordinated? | [c3-pi-voice-service.mmd](c3-pi-voice-service.mmd) | [PNG](c3-pi-voice-service.png) |
| C3 Voice Tool Sandbox | How are Pi's file and shell tools constrained by Gondolin mounts and egress policy? | [c3-voice-tool-sandbox.mmd](c3-voice-tool-sandbox.mmd) | [PNG](c3-voice-tool-sandbox.png) |
| C3 Agent Gateway | Where are capability authentication, owner identity, approval, queue, and public-view policy enforced? | [c3-agent-gateway.mmd](c3-agent-gateway.mmd) | [PNG](c3-agent-gateway.png) |
| C3 Pi Task Worker | How does an approved durable task become an isolated Pi run and bounded result artifacts? | [c3-pi-task-worker.mmd](c3-pi-task-worker.mmd) | [PNG](c3-pi-task-worker.png) |
| C3 Image Build Orchestration | How does a task reuse or dispatch a content-addressed Gitea image workflow? | [c3-image-build-worker.mmd](c3-image-build-worker.mmd) | [PNG](c3-image-build-worker.png) |
| C3 Shared Image Builder | How does one warm Gondolin VM serve trusted repositories without exposing the host Docker socket? | [c3-disposable-image-builder.mmd](c3-disposable-image-builder.mmd) | [PNG](c3-disposable-image-builder.png) |
| C3 Task Tool Runtime | How does a task-specific Pi session discover and constrain Gondolin, memory, browser, and Wassette tools? | [c3-task-tool-runtime.mmd](c3-task-tool-runtime.mmd) | [PNG](c3-task-tool-runtime.png) |
| C3 Host Observability | How are macOS and per-Gondolin-runner resource metrics derived without guest access? | [c3-host-observability.mmd](c3-host-observability.mmd) | [PNG](c3-host-observability.png) |
| D1 interactive voice turn | Where does one microphone turn go before audio and Mermaid return to the browser? | [d1-interactive-voice-turn.mmd](d1-interactive-voice-turn.mmd) | [PNG](d1-interactive-voice-turn.png) |
| D2 delegated task | How does requested project work become an isolated durable task and result? | [d2-delegated-task.mmd](d2-delegated-task.mmd) | [PNG](d2-delegated-task.png) |
| D3 context management | How does the browser observe and compact the persistent Pi context without reading transcript content? | [d3-context-management.mmd](d3-context-management.mmd) | [PNG](d3-context-management.png) |
| Deployment/security | Where do the parts run and which trust boundaries do they cross? | [deployment-security.mmd](deployment-security.mmd) | [PNG](deployment-security.png) |

Each C3 view zooms into exactly one first-party C2 container. Components belonging to another
container stay outside that boundary even when the same repository owns them. Off-the-shelf
containers and data stores—Tailscale, Traefik, PostgreSQL, S3Mock, Gitea, Habitat, and OTel
LGTM—remain external dependencies at C3 because this repository configures rather than implements
their internals. The C3 audience is maintainers and security reviewers deciding where behavior,
policy, or telemetry changes belong.

Pipecat is an off-the-shelf library inside the **Voice Edge**, not a separately deployed service.
It owns WebRTC media orchestration, Silero VAD, Smart Turn v3, STT/LLM/TTS sequencing, heartbeats,
and pipeline metrics. Before turn detection, the edge applies exactly one server-side input filter:
RNNoise by default or VoxLock when owner-voice isolation is enabled. The React client uses Pipecat
RTVI, while Tailscale Serve is the only browser ingress. It exposes the voice UI on tailnet HTTPS
after tailnet authorization. Tailscale terminates TLS and supplies the authenticated identity to a
localhost-only Traefik router. Traefik maps `/` to the Voice Edge, `/metrics/` to Grafana,
`/git/` to Gitea, and `/queue/` to Habitat on one HTTPS origin; there is no Caddy or public/LAN
application port.

The active conversational backend is the native **Pi Voice Service**. The edge calls it through the
capability-limited **Inference Broker**, which converts the streamed native Pi response into the
OpenAI-compatible protocol consumed by Pipecat. The Pi service keeps the conversation session,
public transcript projection, native Pi tools, and a persistent Gondolin voice VM. Ollama remains a
configured fallback behind the broker; it is not the active production path. The voice VM includes
AWS CLI and has one explicit network capability: a synthetic S3Mock origin is rewritten to the
mock's host-loopback endpoint, while other HTTP destinations are denied.

Delegated work is separate. The **Agent Gateway** owns identity and task-lifecycle policy. PostgreSQL
stores both the proposal records and Absurd durable queue schema. S3Mock stores immutable Git bundles
and bounded task outputs. The native **Pi Task Worker** materializes one bundle into temporary scratch
space and invokes Pi with the Gondolin extension. Optional external integrations are exposed through
Wassette with explicit permissions. When `.pi/gondolin.json` declares a project image build, the
task worker checks Gitea Packages and dispatches the repository's fixed Gitea Actions workflow on a cache miss.
The content address covers the declared Docker context, Dockerfile, asset configuration, named build
contexts, image reference, and build options—not the whole repository revision—so application-only
commits reuse an immutable toolchain image package while every declared build-input change invalidates
the cache.
One capacity-one Gitea Runner in a warm, shared Gondolin VM checks out the immutable revision, runs
Docker against its private cached daemon, and publishes completed Gondolin assets as an immutable
generic package. The task worker checkpoints the workflow run ID, verifies the package digest, and
registers the image before Pi starts. No macOS Docker socket is exposed to the worker or VM. Because
the VM cache is shared, only administrator-approved repositories may target its runner label.

**Absurd Habitat** is an off-the-shelf queue operator UI deployed as its own container. It reads and
operates the Absurd schema directly with a dedicated database role, so its query/retry path is
deliberately separate from the Agent Gateway's domain command and approval APIs. The role has no
access to proposal records, and Habitat has no direct host port.

## Model-to-code traceability

| C4 element | Repository evidence |
|---|---|
| Browser Client | `apps/web/src/`; production assets copied by `apps/edge/Containerfile` |
| Browser Client components | `apps/web/src/main.tsx`; `apps/web/src/components/App.tsx`; `TaskPanel.tsx`; `TranscriptView.tsx`; `AudioDiagnosticsView.tsx`; `MermaidDiagram.tsx` |
| Tailnet Ingress | `deploy/compose.yml`; `scripts/compose-login.sh` |
| Path Router | `deploy/traefik/traefik.yml`; `deploy/traefik/routes.yml` |
| Voice Edge | `apps/edge/bot.py`; `apps/edge/Containerfile` |
| Voice Edge components | `apps/edge/bot.py`; `apps/edge/audio_filter.py`; `apps/edge/audio_diagnostics.py`; `apps/edge/visual_response.py`; `apps/edge/otel_bridge.py` |
| Input Audio Filter | `apps/edge/audio_filter.py`; `deploy/prepare_compose.py`; `apps/edge/Containerfile` |
| Inference Broker | `apps/broker/src/voice_agent/speech/presentation/http.py`; broker LaunchAgent |
| Inference Broker components | `apps/broker/src/voice_agent/speech/presentation/http.py`; `application/transcription.py`; `infrastructure/parakeet_stt.py`; `infrastructure/mlx_tts.py` |
| Pi Voice Service | `apps/pi-agent/voice-agent-service.ts`; Pi voice LaunchAgent |
| Pi Voice Service components | `apps/pi-agent/voice-agent-service.ts`; `apps/pi-agent/gondolin-workspace.ts` |
| Pi Context Usage and Compaction | `apps/web/src/components/App.tsx`; `apps/edge/bot.py`; broker HTTP adapter; `apps/pi-agent/voice-agent-service.ts` |
| Voice Tool Sandbox and Runtime Data | `apps/pi-agent/gondolin-workspace.ts`; `scripts/install-launch-agents.sh`; `deploy/launchd/run-pi-agent.sh` |
| Agent Gateway | `apps/gateway/src/voice_gateway/main.py`; `apps/gateway/Dockerfile` |
| Agent Gateway components | `apps/gateway/src/voice_gateway/main.py`; `packages/tasking/src/voice_agent/tasking/application/service.py`; `domain/approval.py`; `infrastructure/artifacts.py` |
| Task Database and Queue | `packages/tasking/migrations/`; `packages/tasking/src/voice_agent/tasking/application/service.py`; Compose Postgres service |
| Durable Queue Dashboard | `deploy/habitat/Containerfile`; `deploy/habitat/entrypoint.sh`; Habitat service in `deploy/compose.yml`; `/queue/` route in `deploy/traefik/routes.yml` |
| Workspace and Result Store | `packages/tasking/src/voice_agent/tasking/infrastructure/artifacts.py`; Compose S3Mock service |
| Pi Task Worker | `apps/worker/src/voice_worker/main.py`; worker LaunchAgent |
| Pi Task Worker components | `apps/worker/src/voice_worker/main.py`; `packages/tasking/src/voice_agent/tasking/application/pi_response.py`; `domain/execution_images.py`; `infrastructure/artifacts.py`; `infrastructure/image_packages.py` |
| Image Build Orchestration | `apps/worker/src/voice_worker/main.py`; `infrastructure/gitea_actions.py`; `domain/execution_images.py`; `infrastructure/image_packages.py` |
| Shared Image Builder | image-builder LaunchAgent; `builder-manager.ts`; `image-builder-workflow.ts`; `image-builder-guest.ts`; builder image definitions |
| Git and Image Package Store | Compose Gitea service; `scripts/gitea-sync.sh`; `packages/tasking/src/voice_agent/tasking/infrastructure/image_packages.py` |
| Task Tool Runtime | `platform/agent-execution/gondolin-session/pi-extension.ts` and its MCP clients |
| Metrics and Traces | `apps/edge/otel_bridge.py`; `packages/telemetry/src/voice_agent/shared/telemetry.py`; Compose `otel-lgtm` service |
| Platform Resource Metrics | `apps/host-observability/gondolin-exporter.mjs`; `deploy/observability/fluent-bit-host.yaml`; `deploy/observability/fluent-bit.yaml`; `deploy/observability/otelcol-config.yaml`; host-observability LaunchAgent; Compose `fluent-bit` service |

## Security perspective

Browser-reachable application code runs in Docker Desktop. The edge and Tailscale container share one
network namespace, while the gateway, Postgres, S3Mock, and OTel LGTM use explicit Compose networks.
Compose Fluent Bit reads the Docker Desktop VM's procfs and sysfs read-only and exports aggregate
system metrics to OTel LGTM on a private monitoring network. Native Fluent Bit reports the physical
Mac, while a loopback-only Node exporter derives per-Gondolin-runner CPU and RSS from registered QEMU
host PIDs. The exporter receives no guest access and does not expose command lines. Neither collector
mounts the Docker socket or attributes Docker VM totals to individual containers.
Security-sensitive containers use read-only roots where supported, drop Linux capabilities, disable
privilege escalation, and receive only narrowly scoped secrets. No service mounts the Docker socket.

Tailscale authenticates the device, applies tailnet policy, terminates trusted HTTPS, strips spoofed
identity headers, and injects the owner identity before its localhost Traefik target. For every
route, Traefik calls the edge's forward-auth endpoint and requires the exact configured owner;
identity-free, different-user, and non-loopback traffic is rejected before path routing. The edge
requires the exact configured origin and single allowed tailnet login before accepting signaling or
owner-scoped HTTP operations. Grafana accepts the injected login only from the fixed Tailscale
container address; direct loopback access continues to require its generated administrator password.

MLX and host-held Pi credentials stay in native loopback-only services because Docker Desktop does not
provide those host capabilities directly. The broker exposes bounded STT, TTS, Pi completion, and
transcript APIs to the edge; it does not expose a generic filesystem, shell, queue, session, or model
selection API. Native Pi tools run inside Gondolin micro-VMs. Optional integration tools run through
Wassette with declared network and secret permissions.

The persistent voice VM receives writable runtime state at `/workspace` and read-only reusable
skills at `/skills`. Source code is not mounted from the host. Deployment mirrors committed refs to
a rootless Gitea container backed by named volumes. The VM receives anonymous clone access to that
single synthetic HTTP origin, but no publisher credential; ignored files, local secrets, and
uncommitted host changes are therefore outside the voice agent's boundary.

OTel exports metrics and traces only. Application log export is disabled, Docker logging is disabled
for content-bearing services, and voice content is deliberately excluded from telemetry. VoxLock's
owner sample is a generated Compose secret, while its digest-verified model is baked into the
read-only edge image; neither is exported through telemetry.

## Render and verify

From the repository root:

```bash
for source in products/voice-agent/docs/architecture/*.mmd; do
  mmdc --input "$source" --output "${source%.mmd}.png" --backgroundColor white --width 2400
done
```

The repository's architecture-visualization product can also compile native Mermaid C4 sources such
as the context view into policy-checked Excalidraw scenes. The lane and sequence views intentionally
use standard Mermaid where it produces a clearer generated artifact than Mermaid's native C4 layout.
