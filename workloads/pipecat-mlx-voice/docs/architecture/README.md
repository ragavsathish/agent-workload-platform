# Architecture

The Mermaid C4 sources are authoritative:

- [C1 context](c1-system-context.mmd) defines the user, platform, and external systems.
- [C2 containers](c2-container.mmd) assigns voice, task, queue, Pi, Gondolin, and Wassette duties.
- [Deployment/security](deployment-security.mmd) maps them to the browser, macOS, Docker Desktop VM,
  and Compose networks.

The deployment view is also an [editable Excalidraw scene](deployment-security.excalidraw),
[SVG](deployment-security.svg), and [PNG](deployment-security.png).

## Model-to-code traceability

| C4 element | Repository evidence |
|---|---|
| Browser Client | `client/src/`; production assets copied into the edge image |
| Tailnet Ingress | `deploy/compose.yml`; `scripts/compose-login.sh` |
| TLS Edge | `deploy/Caddyfile`; `deploy/caddy/Containerfile`; Compose `tls-edge` service |
| Voice Edge | `edge/bot.py`; `edge/Containerfile` |
| Inference Broker | `server/inference_broker.py`; broker LaunchAgent |
| Agent Gateway | `server/agent_gateway.py`; `gateway/Containerfile` |
| Durable Task Store | `server/orchestrator/`; `server/sql/`; Compose Postgres service |
| Pi Worker | `server/orchestrator/worker.py`; worker LaunchAgent |
| Gondolin and Wassette | `runtimes/gondolin-browser/pi-extension.ts` and its MCP clients |

## Security perspective

The Docker Desktop VM contains all browser-reachable code. The voice edge and gateway run as
non-root users with read-only roots, all Linux capabilities dropped, privilege escalation disabled,
resource limits, and no Docker socket. The edge has no database, Pi, provider, session, or workspace
credential. Separate secrets authorize bounded inference and four task lifecycle operations.

Tailscale authenticates devices and provides the private network path. The single-user voice edge
then validates the exact MagicDNS origin and a signed, one-use WebSocket path token before binding
the session to the owner login pinned by setup. Raw tailnet TCP passes TLS to a minimal Caddy
sidecar that advertises HTTP/1.1 only, preserving Safari's WebSocket upgrade without relying on a
proxy-injected identity header.

This shared Docker VM is a pragmatic host boundary, not the stronger independent libkrun VM used by
the previous design. The highest-risk work remains outside the voice stack: Pi invokes file,
browser, and integration tools through Gondolin micro-VMs and Wassette components.

YOLO voice approval is a replaceable policy seam. A later explicit voice turn can approve the exact
pending plan, while the gateway binds that transition to identity, stored plan hash, expiry, and one
durable task. Face ID/WebAuthn can later replace this policy without changing the queue or worker.
