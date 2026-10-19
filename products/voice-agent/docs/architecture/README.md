# Voice Agent architecture

Audience: maintainers, reviewers, and operators of the Voice Agent product.

The Mermaid architecture files are the parseable source of truth. Rendered PNG files are generated
views and must not be edited by hand. C4 boundaries and terminology define the static views; sequence
notation is used for runtime views because it preserves order without crossing relationship labels.

| View | Question answered | Source | Render |
|---|---|---|---|
| C1 system context | Who uses the Voice Agent and which external systems does it depend on? | [c1-system-context.mmd](c1-system-context.mmd) | [PNG](c1-system-context.png) |
| C2 containers | Which independently running parts own voice, Pi, task, artifact, and telemetry responsibilities? | [c2-container.mmd](c2-container.mmd) | [PNG](c2-container.png) |
| C3 Browser Voice Client | Which Flutter components own conversation control, diagrams, tasks, and transcript? | [c3-browser-client.mmd](c3-browser-client.mmd) | [PNG](c3-browser-client.png) |
| C3 Input Diagnostics | Which React components own live input monitoring, selected-filter replay, and model charts? | [c3-input-diagnostics.mmd](c3-input-diagnostics.mmd) | [PNG](c3-input-diagnostics.png) |
| C3 Voice Edge | How does Pipecat turn browser audio into an authenticated, observable voice pipeline? | [c3-voice-edge.mmd](c3-voice-edge.mmd) | [PNG](c3-voice-edge.png) |
| C3 Inference Broker | Which narrow adapters expose native STT, TTS, Pi streaming, context, and fallback inference? | [c3-inference-broker.mmd](c3-inference-broker.mmd) | [PNG](c3-inference-broker.png) |
| C3 Pi Voice Service | How are persistent Pi turns, tools, transcript, context, skills, and the voice VM coordinated? | [c3-pi-voice-service.mmd](c3-pi-voice-service.mmd) | [PNG](c3-pi-voice-service.png) |
| C3 Voice Tool Sandbox | How are Pi's file and shell tools constrained by Gondolin mounts and egress policy? | [c3-voice-tool-sandbox.mmd](c3-voice-tool-sandbox.mmd) | [PNG](c3-voice-tool-sandbox.png) |
| C3 Agent Gateway | Where are capability authentication, owner identity, approval, queue, and public-view policy enforced? | [c3-agent-gateway.mmd](c3-agent-gateway.mmd) | [PNG](c3-agent-gateway.png) |
| C3 Pi Task Worker | How does an approved durable task become an isolated Pi run and bounded result artifacts? | [c3-pi-task-worker.mmd](c3-pi-task-worker.mmd) | [PNG](c3-pi-task-worker.png) |
| C3 Image Build Orchestration | How does a task reuse or dispatch a content-addressed Gitea image workflow? | [c3-image-build-worker.mmd](c3-image-build-worker.mmd) | [PNG](c3-image-build-worker.png) |
| C3 Shared Image Builder | How does one warm Gondolin VM serve trusted repositories without exposing the host Docker socket? | [c3-disposable-image-builder.mmd](c3-disposable-image-builder.mmd) | [PNG](c3-disposable-image-builder.png) |
| C3 Pi Task Session | How does a task-specific Pi process discover and constrain Gondolin, memory, browser, and Wassette tools? | [c3-task-tool-runtime.mmd](c3-task-tool-runtime.mmd) | [PNG](c3-task-tool-runtime.png) |
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
RNNoise by default or VoxLock when owner-voice isolation is enabled. The shared Flutter client currently uses a
narrow JavaScript adapter around Pipecat's official browser transport and Mermaid on web. Its iOS and
Android runners compile the same Dart UI behind a platform-neutral voice-session interface; native
Pipecat adapters remain planned rather than represented as deployed containers. Conversation,
chat/task, responsive state, and voice controls remain in Dart. Input diagnostics is a separate
React bundle at `/diagnostics/`; it uses Recharts and WaveSurfer without loading the Flutter runtime.
Grafana provisions the **C4 Operational Heat Map** dashboard. At build time,
`deploy/observability/generate-c4-heatmap.mjs` reads the authoritative Mermaid and evidence sources,
then uses the deterministic, dependency-free `deploy/observability/c4-dashboard.mjs` adapter to
compile the provisioned dashboard JSON. Grafana uses
the pinned Grafmaid panel plugin to render C1, C2, all twelve C3 views, and the deployment view.
On the C2 container view, source-backed evidence colors borders and fixed PromQL queries color
instrumented fills for missing or stale telemetry, idle services, and activity intensity in the
selected dashboard range. C1, C3, and deployment backgrounds remain neutral gray so only the C2
container trace is highlighted. Traffic volume is not treated as component health. The
dashboard also contains the dated executable-line evidence snapshot formerly shown by the React
coverage page; Grafana is now the single coverage and operational-health UI. Regenerate
`deploy/observability/c4-heatmap.json` with `make grafana-c4-dashboard` after changing a C4 source or evidence mapping.
Run `make playwright-grafana` to scroll and render every lazy panel, verify the computed palette,
and retain a screenshot, browser evidence, and Playwright trace.
The official Grafana MCP server is a separate read-only container. Authenticated MCP clients reach it
over loopback streamable HTTP to inspect this dashboard and query Prometheus or Tempo.
The upstream Tempo MCP App provides an interactive trace view in compatible hosts; PromQL remains
available through the server tool, and the Mermaid C4 panels continue to render in Grafana.
Pi Voice registers Grafana MCP explicitly as a deferred provider. For an inline trace, the model
returns only bounded identifiers; Voice Edge then retrieves the upstream App resource and structured
trace result behind the authenticated tailnet boundary. The browser's sandboxed MCP Apps bridge
receives no Grafana bearer token and supplies its dark host theme to the upstream App.
Oxigraph is provisioned as a persistent RDF data-store container on the private Compose `data`
network. Its unauthenticated SPARQL endpoint is published on Mac loopback only. The Agent Gateway
continues to provide fixed, bounded personal-knowledge queries, while the isolated voice VM has a
synthetic route to that loopback endpoint and a raw `oxigraph` query/update CLI. The endpoint is not
reachable from the LAN or tailnet, but arbitrary agent-generated SPARQL is an intentional YOLO-mode
write capability.
The adapter speaks RTVI, while Tailscale Serve is the only browser ingress. It exposes the voice UI on tailnet HTTPS
after tailnet authorization. Tailscale terminates TLS and supplies the authenticated identity to a
localhost-only Traefik router. Traefik maps `/` to the Voice Edge, `/metrics/` to Grafana,
`/git/` to Gitea, and `/queue/` to Habitat on one HTTPS origin; there is no Caddy or public/LAN
application port.

The active conversational backend is the native **Pi Voice Service**. The edge calls it through the
capability-limited **Inference Broker**, which converts the streamed native Pi response into the
OpenAI-compatible protocol consumed by Pipecat. The Pi service keeps the conversation session,
public transcript projection, native Pi tools, and a persistent Gondolin voice VM. Ollama remains a
configured fallback behind the broker; it is not the active production path. The voice VM includes
AWS CLI and has four explicit synthetic network origins—S3Mock, read-only Gitea,
Prometheus, and Oxigraph—rewritten to their host-loopback endpoints, while
other HTTP destinations are denied. Unlike the bounded gateway knowledge tool,
the Oxigraph CLI permits raw RDF updates in this single-owner deployment.
The Pi Voice Service also registers a host-native Wassette subprocess through Pi's deferred MCP
extension. `tool_search` discovers tools from the configured component directory without adding all
schemas to every model turn. The child receives a credential-scrubbed environment and its WASM
components can use only their persisted Wassette capability grants. The composed tasking component
owns the task lifecycle tools. A separate personal-knowledge component owns the bounded read-only
digital-twin query and receives a reader-only token; it cannot enqueue work or write RDF. Both receive
only their component-specific settings through a mode-0600 env file. This path is separate from the
Gondolin VM used by Pi's native file and shell tools.
Delegated work is separate. The **Agent Gateway** owns identity and task-lifecycle policy. PostgreSQL
stores both the proposal records and Absurd durable queue schema. S3Mock stores immutable Git bundles
and bounded task outputs. The native **Pi Task Worker** materializes a selected bundle into temporary
task space, or allocates an empty task-scoped `scratch` workspace when no repository was selected,
then invokes Pi with the Gondolin extension. Scratch tasks use a worker-controlled default image and
publish a bounded workspace ZIP rather than a Git patch. Missing named repositories fail explicitly;
they never silently become scratch tasks. Optional external integrations are exposed through
Wassette with explicit permissions. When `.pi/gondolin.json` declares a project image build, the
task worker checks Gitea Packages and dispatches the repository's fixed Gitea Actions workflow on a cache miss.
The content address covers the declared Docker context, Dockerfile, asset configuration, named build
contexts, image reference, and build options—not the whole repository revision—so application-only
commits reuse an immutable toolchain image package while every declared build-input change invalidates
the cache.
The worker requires the installed Git skills bundle for every durable Pi session: Pi receives it
through its explicit `--skill` option, and Gondolin mounts the same directory read-only at `/skills`.
The scratch root stays outside the account home because Pi discovers `.agents/skills` in workspace
ancestors; a home-rooted scratch task can otherwise follow the owner's skill symlinks into protected
`Documents` paths before its first RPC response.
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
| Browser Voice Client | `apps/client/lib/`; production Flutter web assets copied by `apps/edge/Containerfile` |
| Browser Voice Client components | `apps/client/lib/main.dart`; `views/voice_view.dart`; `views/pi_workspace_view.dart`; `widgets/mcp_app_view_web.dart`; `platform/voice_session_web.dart`; `bridge/voice_bridge.js`; `bridge/mermaid_app.js`; the lazy Excalidraw app is built from `vendor/excalidraw-mcp` by `tool/build-excalidraw-app.mjs` |
| Mobile Client foundation | `apps/client/ios/`; `apps/client/android/`; `apps/client/lib/platform/voice_session.dart`; native adapters are not implemented yet |
| Input Diagnostics | `apps/diagnostics/`; React bundle emitted to `apps/diagnostics/dist/` |
| Engineering Evidence and C4 Explorer | `deploy/observability/generate-c4-heatmap.mjs`; `deploy/observability/c4-dashboard.mjs`; provisioned Grafana dashboard generated from these Mermaid sources |
| Grafana MCP | Official pinned `grafana/mcp-grafana` Compose service; Viewer service account; authenticated loopback streamable HTTP; PromQL tools and Tempo trace MCP App |
| Tailnet Ingress | `deploy/compose.yml`; `tools/ops/login.py` |
| Path Router | `deploy/traefik/traefik.yml`; `deploy/traefik/routes.yml` |
| Voice Edge | `apps/edge/bot.py`; `apps/edge/Containerfile` |
| Voice Edge components | `apps/edge/bot.py`; `apps/edge/audio_filter.py`; `apps/edge/audio_diagnostics.py`; `apps/edge/presentation_response.py`; `apps/edge/otel_bridge.py` |
| Input Audio Filter | `apps/edge/audio_filter.py`; `tools/config/init_secrets.py`; `apps/edge/Containerfile` |
| Inference Broker | `apps/broker/src/voice_agent/speech/presentation/http.py`; broker LaunchAgent |
| Inference Broker components | `apps/broker/src/voice_agent/speech/presentation/http.py`; `application/transcription.py`; `infrastructure/parakeet_stt.py`; `infrastructure/mlx_tts.py` |
| Pi Voice Service | `apps/pi-agent/voice-agent-service.ts`; Pi voice LaunchAgent |
| Pi Voice Service components | `apps/pi-agent/voice-agent-service.ts`; `apps/pi-agent/voice-agent/`; `platform/agent-execution/gondolin-session/session.ts` |
| Tasking Wassette component | `components/tasking-ts/src/core/index.ts`; `components/tasking-ts/src/gateway-http/lib.rs`; `components/tasking-ts/wit/world.wit` |
| Pi Context Usage and Compaction | `apps/client/lib/views/voice_view.dart`; `apps/edge/bot.py`; broker HTTP adapter; `apps/pi-agent/voice-agent-service.ts` |
| Voice Tool Sandbox and Runtime Data | `apps/pi-agent/voice-agent/voice-gondolin.ts`; `platform/agent-execution/gondolin-session/session.ts`; `automation/roles/host_services`; `deploy/launchd/com.sathish.pipecat-pi-voice.plist` |
| Agent Gateway | `apps/gateway/src/voice_gateway/main.py`; `apps/gateway/Dockerfile` |
| Agent Gateway components | `apps/gateway/src/voice_gateway/main.py`; `packages/tasking/src/voice_agent/tasking/application/service.py`; `domain/approval.py`; `infrastructure/artifacts.py` |
| Task Database and Queue | `packages/tasking/migrations/`; `packages/tasking/src/voice_agent/tasking/application/service.py`; Compose Postgres service |
| Durable Queue Dashboard | `deploy/habitat/Containerfile`; `deploy/habitat/entrypoint.sh`; Habitat service in `deploy/compose.yml`; `/queue/` route in `deploy/traefik/routes.yml` |
| Workspace and Result Store | `packages/tasking/src/voice_agent/tasking/infrastructure/artifacts.py`; Compose S3Mock service |
| Pi Task Worker | `apps/worker/src/voice_worker/main.py`; worker LaunchAgent |
| Pi Task Worker components | `apps/worker/src/voice_worker/main.py`; `packages/tasking/src/voice_agent/tasking/application/pi_response.py`; `domain/execution_images.py`; `infrastructure/artifacts.py`; `infrastructure/image_packages.py` |
| Image Build Orchestration | `apps/worker/src/voice_worker/main.py`; `infrastructure/gitea_actions.py`; `domain/execution_images.py`; `infrastructure/image_packages.py` |
| Shared Image Builder | image-builder LaunchAgent; `platform/agent-execution/gondolin-session/image-builder/` |
| Git and Image Package Store | Compose Gitea service; `tools/ops/gitea_sync.py`; `packages/tasking/src/voice_agent/tasking/infrastructure/image_packages.py` |
| Pi Task Session tools | `platform/agent-execution/gondolin-session/pi-extension.ts`; MCP servers from Pi configuration |
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
Wassette in separate native subprocesses with declared network and environment permissions. Wassette
is not inside a Gondolin VM: the Pi Voice Service and each Pi task session reach it over stdio, while
native file, shell, and browser tools remain routed into their corresponding Gondolin VM.

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

The browser presents Mermaid, Excalidraw, and Marp through its MCP App host. Architecture sources in
this directory remain Mermaid because they are reviewable, source-controlled, and directly renderable;
lane and sequence views use standard Mermaid where it is clearer than native C4 layout.
