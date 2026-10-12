# Architecture

The Mermaid C4 sources are authoritative:

They are rendered with Mermaid CLI (`mmdc`). The deployment PNG is a checked-in preview; the `.mmd`
files remain the editable source. The context, container, and component views use the same grouped
flowchart style so the primary path stays local and arrows do not cross the whole canvas.

- [C1 context](c1-system-context.mmd) defines the user, platform, and external systems.
- [C2 containers](c2-container.mmd) assigns voice, task, queue, Pi, Gondolin, and Wassette duties.
- [C3 Pipecat pipeline](c3-pipecat-pipeline.mmd) isolates the five off-the-shelf Pipecat building
  blocks from the application-specific policy and UI processors.
- [Deployment/security](deployment-security.mmd) maps them to the browser, macOS, Docker Desktop VM,
  and Compose networks.

## What Pipecat provides

Pipecat is the open-source orchestration library inside the `voice-edge` container. It provides
the frame pipeline, turn processing, transport adapters, and service adapters; it is not a second
deployment tier and it does not own persistence or task execution. This deployment uses five
Pipecat library components:

| Pipecat component | Responsibility | Integration owned by this repository |
|---|---|---|
| `SmallWebRTCTransport` | Browser microphone/speaker transport | Tailscale origin and one-use session authentication |
| `SileroVADAnalyzer` | Speech-boundary detection | Turn policy and speaker-verification gate in the broker |
| `OpenAISTTService` | STT service adapter | MLX Whisper broker endpoint |
| `OpenAILLMService` | OpenAI-compatible chat adapter | Ollama or Pi-compatible broker endpoint and task functions |
| `OpenAITTSService` | TTS service adapter | MLX/Kokoro broker endpoint |

The application-specific pieces are `VoiceVisualResponseProcessor` (JSON-to-spoken/Mermaid
splitting), the four bounded task lifecycle functions, identity/origin validation, and telemetry.
The broker owns model execution; the gateway owns durable task transitions; the worker owns Pi
execution; Gondolin and Wassette own tool isolation. Keeping those responsibilities outside the
Pipecat library prevents the diagram from implying that Pipecat is a queue, model server, or
sandbox.

## Model-to-code traceability

| C4 element | Repository evidence |
|---|---|
| Browser Client | `client/src/`; production assets copied into the edge image |
| Tailnet Ingress | `deploy/compose.yml`; `scripts/compose-login.sh` |
| Tailnet HTTPS ingress | Compose `tailscale` service; `scripts/compose-login.sh` |
| Voice Edge | `edge/bot.py`; `edge/Containerfile` |
| Inference Broker | `server/inference_broker.py`; broker LaunchAgent |
| Agent Gateway | `server/agent_gateway.py`; `gateway/Containerfile` |
| Durable Task Store | `server/orchestrator/`; `server/sql/`; Compose Postgres service |
| Pi Worker | `server/orchestrator/worker.py`; worker LaunchAgent |
| Host service supervisor | `scripts/host-services.sh`; `deploy/launchd/com.sathish.pipecat-host-services.plist` |
| Gondolin and Wassette | `runtimes/gondolin-browser/pi-extension.ts` and its MCP clients |

## Security perspective

The Docker Desktop VM contains all browser-reachable code. The voice edge and gateway run as
non-root users with read-only roots, all Linux capabilities dropped, privilege escalation disabled,
resource limits, and no Docker socket. The edge has no database, Pi, provider, session, or workspace
credential. Separate secrets authorize bounded inference and four task lifecycle operations.

Tailscale authenticates devices, terminates trusted HTTPS, and provides the private network path.
The single-user voice edge validates the injected tailnet identity, exact MagicDNS origin, and a
signed, one-use WebSocket path token before binding the session to the owner login pinned by setup.

This shared Docker VM is a pragmatic host boundary, not the stronger independent libkrun VM used by
the previous design. The highest-risk work remains outside the voice stack: Pi invokes file,
browser, and integration tools through Gondolin micro-VMs and Wassette components.

YOLO voice approval is a replaceable policy seam. A later explicit voice turn can approve the exact
pending plan, while the gateway binds that transition to identity, stored plan hash, expiry, and one
durable task. Face ID/WebAuthn can later replace this policy without changing the queue or worker.
