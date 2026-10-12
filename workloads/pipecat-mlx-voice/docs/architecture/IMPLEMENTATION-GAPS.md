# Architecture-to-code audit

This audit compares [`workspace.dsl`](workspace.dsl) with the Compose file, host scripts, and
application sources. The DSL is not allowed to describe an intended service as if it were already
implemented.

## Blocking gap

| Element | Evidence | Impact | Required resolution |
|---|---|---|---|
| Native Pi Voice | `scripts/host-pi-voice.sh` executes `dist/voice-agent-service.js`; `scripts/install-host-services.sh` builds and deploys `runtimes/gondolin-browser`, but that runtime contains no `voice-agent-service.ts` or generated equivalent. | The host supervisor cannot start the Pi voice RPC service on a fresh checkout. `make up` can converge the broker and worker checks only if an external artifact happens to provide that file. | Add the service source and its dependencies to `runtimes/gondolin-browser`, or remove the service from the deployment until it is implemented. Add a build assertion for the expected output. |

## Corrected model gaps

| Element | Finding | Correction |
|---|---|---|
| Observability | Compose runs `otel-lgtm`; `edge/bot.py`, `server/inference_broker.py`, and `server/agent_gateway.py` export OTLP metrics/traces. | Added `Observability` as a container and connected all three producers in the DSL. |
| Gondolin/Wassette | The Pi extension starts/uses these runtimes as tool capabilities; they are not independently managed LaunchAgents or Compose services. | Kept them visible as runtime boundaries and explicitly labelled them as child runtimes, not standalone daemons. |
| Compose init helpers | `s3mock-init` only changes volume ownership and exits. | Intentionally omitted from the steady-state container view; it is a deployment helper, not an application container. |
| Host supervisor | `host-services.sh` is operational supervision, not application behavior. | Kept in the deployment view as the macOS LaunchAgent boundary rather than as a normal application container. |

## Verified alignments

- `voice-edge` uses Pipecat `SmallWebRTCTransport`, `SileroVADAnalyzer`, and the OpenAI-compatible
  STT/LLM/TTS adapters.
- The gateway owns proposal, status, approval, and cancellation routes and persists through
  Postgres/Absurd.
- The worker consumes the Absurd queue, invokes Pi with the Gondolin extension, and uses the
  artifact store when configured.
- Tailscale is Compose-managed and `compose-login.sh` configures the private Serve endpoint.
