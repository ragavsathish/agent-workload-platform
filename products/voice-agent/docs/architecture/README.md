# Architecture

The Mermaid C4 sources are authoritative:

- [C1 context](c1-system-context.mmd) defines the user, platform, and external systems.
- [C2 containers](c2-container.mmd) assigns voice, task, queue, Pi, Gondolin, and Wassette duties.
- [Deployment/security](deployment-security.mmd) maps them to the browser, macOS, Docker Desktop VM,
  and Compose networks.

## Model-to-code traceability

| C4 element | Repository evidence |
|---|---|
| Browser Client | `client/src/`; production assets copied into the edge image |
| Tailnet Ingress | `deploy/compose.yml`; `scripts/compose-login.sh` |
| Tailnet HTTPS ingress | Compose `tailscale` service; `scripts/compose-login.sh` |
| Voice Edge | `edge/bot.py`; `edge/Containerfile` |
| Inference Broker | `server/src/voice_agent/speech/presentation/http.py`; broker LaunchAgent |
| Agent Gateway | `server/src/voice_agent/tasking/presentation/gateway.py`; `gateway/Containerfile` |
| Durable Task Store | `server/src/voice_agent/tasking/`; `server/migrations/`; Compose Postgres service |
| Pi Worker | `server/src/voice_agent/tasking/workers/pi_worker.py`; worker LaunchAgent |
| Pi Voice Service | `services/pi-agent/voice-agent-service.ts`; Pi voice LaunchAgent |
| Voice Gondolin Workspace | `services/pi-agent/gondolin-workspace.ts` |
| Worker Gondolin and Wassette | `platform/agent-execution/gondolin-session/pi-extension.ts` and its MCP clients |

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

YOLO voice submission is a replaceable policy seam. The Pi Voice Service can
submit requested asynchronous work immediately; a separate proposal path
requires a later explicit turn to approve the exact pending plan. The gateway
binds approval to identity, stored plan hash, expiry, and one durable task. A UI
or Face ID/WebAuthn capability can later replace this boundary without changing
the queue or worker.
