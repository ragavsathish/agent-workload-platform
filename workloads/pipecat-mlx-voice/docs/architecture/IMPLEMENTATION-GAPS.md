# Architecture-to-code audit

This audit compares [`workspace.dsl`](workspace.dsl) with the Compose file, host scripts, and
application sources. The DSL is not allowed to describe an intended service as if it were already
implemented.

## Blocking gap

| Element | Evidence | Impact | Required resolution |
|---|---|---|---|
| Native Pi Voice | `scripts/host-pi-voice.sh` executes `dist/voice-agent-service.js`. The source existed in historical commit `cf284d1` and implemented Pi transcript state plus `/v1/transcript`, but it is absent from the current runtime snapshot after `38619b3`; its historical source also referenced missing `gondolin-workspace.ts` and undeclared Pi/typebox dependencies. | The host supervisor cannot start the Pi voice RPC service on a fresh checkout. The current browser transcript therefore comes from the Pipecat context, not Pi's transcript projection. | Restore and complete the historical service (including its workspace adapter and declared dependencies), or remove the Pi voice LaunchAgent and Pi transcript UI. The install script now fails explicitly when the expected artifact is missing. |

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
