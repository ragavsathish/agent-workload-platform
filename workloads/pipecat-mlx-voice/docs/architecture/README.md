# Architecture

These C4 views document the Pipecat MLX Voice workload for operators and
security reviewers. The software system in scope starts at the browser client,
crosses the isolated voice edge, and ends at the narrow inference broker on the
Mac. Tailscale, Ollama, and artifact registries are external systems. The
optional Postgres/Absurd/Pi task stack is outside this system and has no route
from the deployed edge.

The Mermaid sources are authoritative:

- [C1 system context](c1-system-context.mmd) defines the users, system scope,
  and external dependencies.
- [C2 container view](c2-container.mmd) assigns runtime responsibilities and
  makes the inference capability path explicit.
- [Deployment and security view](deployment-security.mmd) maps those containers
  to the phone, Mac, and libkrun micro-VM and records the enforced isolation
  properties.

The deployment view is also available as an
[editable Excalidraw scene](deployment-security.excalidraw),
[SVG](deployment-security.svg), and [PNG](deployment-security.png). These are
generated representations; update the Mermaid model first and regenerate all
three together.

## Model-to-code traceability

| C4 element | Evidence in this workload |
|---|---|
| Browser Client | `client/src/` and the production build copied into the edge image |
| Tailnet Ingress | `deploy/quadlet/pipecat-tailscale.container` and `scripts/podman-edge-login.sh` |
| Voice Edge | `edge/bot.py`, `edge/Containerfile`, and `deploy/quadlet/pipecat-edge.container` |
| Inference Tunnel | `scripts/podman-edge-tunnel.sh` and its macOS LaunchAgent |
| Inference Broker | `server/inference_broker.py`, `server/mlx_tts.py`, and its macOS LaunchAgent |
| Ollama | `OLLAMA_BASE_URL` and exact `OLLAMA_MODEL` enforcement in the broker |

## Security perspective

Identity and capability are separate controls. Tailscale Serve authenticates
the browser identity, and the edge accepts only configured exact user logins.
The broker independently requires a mounted bearer secret and rejects generic
proxying, remote tool calls, unapproved model selection, oversized payloads,
and unsupported audio formats.

The libkrun VM is the host isolation boundary. Rootless containers add defense
in depth through read-only roots, dropped capabilities, `NoNewPrivileges`, and
resource limits. The Mac initiates the reverse SSH connection and exposes only
its loopback broker on VM loopback; the VM receives neither a host filesystem
mount nor a route for logging into the Mac.

Tailscale Serve is private tailnet ingress, not anonymous Internet exposure.
Funnel is not enabled. Registry access is a provisioning dependency rather
than part of the browser voice request path, and deployed Quadlets use reviewed
image digests with `Pull=never`.

## Runtime request path

1. An approved user loads the client and opens its WebSocket through Tailscale
   Serve.
2. The ingress adds the verified Tailscale login; the edge checks it against
   the exact allowlist before accepting audio.
3. Pipecat applies Silero VAD and sends bounded STT, chat, and TTS requests to
   the broker endpoint on VM loopback.
4. The host-initiated reverse tunnel carries those requests to the Mac broker.
5. The broker runs MLX Whisper and MLX Kokoro in-process and sends exact-model
   chat requests to loopback Ollama.
6. Synthesized PCM returns over the same constrained path to the browser.

## Assumptions and exclusions

- The Tailscale account and device approval process are trusted identity roots.
- The Mac user account, LaunchAgent configuration, and Podman machine keys are
  trusted host administration surfaces.
- Model and image changes require source review and reprovisioning; digest
  pinning does not evaluate artifact behavior.
- Agent dispatch, task approval, Pi sessions, Postgres, and Absurd are excluded
  from the exposed system until a separate approval factor is designed.
