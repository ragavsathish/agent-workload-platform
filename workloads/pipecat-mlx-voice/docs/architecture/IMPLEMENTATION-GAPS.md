# Architecture-to-code audit

This audit compares [`workspace.dsl`](workspace.dsl) with the Compose file, host scripts, and
application sources. The DSL is not allowed to describe an intended service as if it were already
implemented.

## Previously blocking gap — resolved

| Element | Evidence | Impact | Required resolution |
|---|---|---|---|
| Native Pi Voice | The service and transcript projection were present in `cf284d1` but were omitted by the later runtime snapshot; the historical source also referenced missing `gondolin-workspace.ts` and undeclared Pi/typebox dependencies. | This was a real regression: the LaunchAgent could not produce `dist/voice-agent-service.js`, so Pi transcript requests failed. | Restored `voice-agent-service.ts`, added the Gondolin VM workspace adapter and declared dependencies, added build-time artifact validation, and added unit coverage for transcript projection. |

## Corrected model gaps

| Element | Finding | Correction |
|---|---|---|
| Observability | Compose runs `otel-lgtm`; `edge/bot.py`, `server/inference_broker.py`, and `server/agent_gateway.py` export OTLP metrics/traces. | Added `Observability` as a container and connected all three producers in the DSL. |
| Gondolin/Wassette | The Pi extension and restored native voice service start/use these runtimes as tool capabilities; they are not independently managed LaunchAgents or Compose services. | Kept them visible as runtime boundaries and explicitly labelled them as child runtimes, not standalone daemons. |
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
- The native Pi service receives normalized Pipecat turns through `/pi/v1/chat/completions`, keeps
  its bounded transcript projection at `/v1/transcript`, and the browser reads it through
  `/api/pi-transcript`.
