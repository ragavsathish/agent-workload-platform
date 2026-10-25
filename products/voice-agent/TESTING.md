# Voice black-box testing

## Test groups

Group tests by the production boundary they prove:

| Group | Entry boundary | Production path kept real | Primary assertion |
|---|---|---|---|
| Contract | MCP client or application API | Tool schema, validation, state transition, and resource contract | Structured result and bounded side effect |
| Protocol black box | Browser-facing WebRTC and RTVI | Voice Edge, STT, Pi, MCP selection, and response TTS | Completed audio and expected MCP App message |
| UI black box | Flutter or MCP App browser host | Bridge, iframe sandbox, app rendering, and interaction | Visible content, security policy, and user action |
| Deployed system | Public service entry point | Cross-process services, persistence, and telemetry | Public result, durable state, and fresh metrics |
| Ingress security | Authenticated tailnet route | Identity forwarding and protected routing | Allowed owner access and rejected invalid access |

The protocol-driver pattern replaces only a physical or nondeterministic outer edge. For voice,
`smallwebrtc_voice.py` replaces the microphone and browser peer with deterministic TTS audio and an
`aiortc` client. It still enters through the production WebRTC offer, streams real-time 20 ms audio
frames, and keeps VAD, STT, Pi, MCP calls, presentation delivery, and response TTS real. Do not
inject text directly into STT or Pi when the test claims voice-path coverage.

Keep protocol and UI black boxes separate so failures identify the broken boundary. SmallWebRTC
proves speech-to-presentation delivery; browser tests prove presentation-to-rendered-app behavior.
Use a small full-path smoke suite to join them rather than duplicating every scenario end to end.

## Ansible verification black box

`make verify` is the read-only conformance check for an already deployed system. It observes the
system from operator-visible boundaries instead of importing application modules or reproducing
their private assertions.

It verifies:

- expected containers and one-shot jobs are running or completed;
- read-only filesystems, dropped capabilities, privilege restrictions, mounts, ports, and logging;
- protected endpoint authentication and the deployed Voice Edge feature contract;
- Tailscale Serve routing when an authenticated tailnet is available;
- native LaunchAgent state and host/Gondolin metric endpoints;
- real Grafana MCP, Oxigraph, Postgres, Gitea, Prometheus, and Tempo contracts;
- restricted database, repository, token, and network capabilities.

Ansible verification establishes the **deployment envelope**. It does not replace a user journey:

| Entry point | Responsibility |
|---|---|
| `make verify` | Read-only deployed configuration, security, dependency, and telemetry contract |
| `make cycle-test` | Start/stop/recovery and lifecycle behavior that intentionally changes deployed state |
| `make blackbox-voice` | Real voice protocol journey without requiring a durable task result |
| `make blackbox-remote-session` | Persistent spoken session that proposes, approves, attaches, and converses with an Agent Task |
| `make blackbox-e2e` | Real voice journey plus durable effects and fresh exercised-path metrics |
| `make playwright-voice` | Browser and Flutter behavior through local ingress |
| Tailnet Playwright targets | Behavior specifically owned by authenticated ingress |

Run `make verify` before a black-box journey when diagnosing the environment. A passing verification
means the required deployment envelope is present; require a fresh public result, durable record, or
metric increment before claiming that the requested journey itself worked.

Infrastructure verification and lifecycle tests are Ansible playbooks under
[`automation/`](automation/README.md). Run `make automation-setup` once before
using `make verify`, `make cycle-test`, or `make digital-twin-test`.

The black-box runner uses no microphone shortcut and no direct STT injection. It asks the native
Kokoro broker to synthesize an utterance, resamples the PCM to browser input format, and creates an
`aiortc` peer against the browser-facing WebRTC offer endpoint. After the welcome turn, its synthetic
microphone streams 20 ms audio frames at real-time cadence. The resulting Parakeet v3 MLX transcript
drives Pi and the configured MCP tools; response audio and RTVI messages return through the same
peer connection.

```bash
make warm-models
make blackbox-e2e
make blackbox-personal-knowledge
make blackbox-remote-session
make blackbox-voice \
  UTTERANCE="Propose a task in the default workspace to inspect it without changing files"

# Multiple turns, including approval, can be passed as JSON:
BLACKBOX_UTTERANCES_JSON='["Propose a task in the default workspace to report ready without changing files", "Approve that pending task now"]' \
  make blackbox-voice
```

Multiple utterances share one WebRTC peer and one Voice Session. The remote-session target uses that
boundary for propose, approve, attach, and follow-up turns, then requires fresh successful
Pi Voice remote-session attachment and command metrics. This prevents an ordinary local response from passing
as a remote Agent Task conversation.

Voice Edge admits one active Voice Session at a time because the Pi Voice Service intentionally owns
one persistent owner context and one remote Agent Task attachment. A concurrent WebRTC peer is
disconnected before its transport starts; allowing it to proceed would mix conversation context and
let either peer's disconnect detach the other's Agent Task.

`blackbox-personal-knowledge` inserts one isolated RDF fixture, invokes the typed tool through
Wassette MCP, the authenticated gateway, and Oxigraph, and then removes the fixture. Its broad
natural-language query includes unmatched terms and guards against the former all-terms-required
filter returning an empty fact list. The overall `blackbox-e2e` target includes this regression.

The runner automatically retains an authenticated production Tailscale sidecar. When no
authenticated sidecar is running, it uses `deploy/compose.local-test.yml` as a stable network
namespace with no listener or tunnel. Set `BLACKBOX_USE_TAILSCALE=true` or `false` only to override
that detection explicitly; local mode replaces ingress for the duration of that Compose project
and is therefore inappropriate while a browser session is active.

Before the first voice task, publish the exact committed source snapshot:

```bash
make publish-workspace \
  WORKSPACE_ID=agent-workload-platform \
  REPOSITORY=/path/to/agent-workload-platform
```

The proposal stores the resulting content-addressed S3 URI, not a host filesystem path.
Verification also asserts that S3Mock is loopback-only and has no Documents bind mount.
The runner intentionally prints only audio byte counts and event counts; it never prints recognized
or synthesized text. Compose verification fails if Docker logging is enabled for the voice edge or
gateway, if OpenTelemetry log export is enabled, if Grafana allows anonymous access, or if an
observability port is published beyond loopback. The end-to-end test snapshots payload-free
operation counters before synthetic audio starts, then queries them through Grafana after the run.
Compose verification also initializes the real Grafana MCP streamable-HTTP session, reads the C4
dashboard summary, queries `up{job="grafana-mcp"}` through the Prometheus tool, and asserts that the Tempo tool
advertises the upstream interactive trace MCP App resource.
The voice Playwright suite fetches a real Tempo trace, mounts Grafana's official App inside the
voice-chat MCP host, waits for populated span data rather than its loading state, verifies the dark
theme, and retains the Playwright trace and screenshot.

The ordinary voice and diagnostics browser suites use the loopback ingress and do not require a
Tailscale login or control-plane connection:

```bash
make playwright-voice
make playwright-diagnostics
```

They run in the deployment's shared network namespace and connect directly to Traefik's local
entry point at `127.0.0.1:8081`. The Grafana MCP App assertion and direct Grafana suite remain
explicit ingress-security tests because `/metrics/` intentionally exists only behind authenticated
tailnet routing. Run those separately with `make playwright-tailnet-voice` or
`make playwright-grafana`. `make playwright-tailnet-diagnostics` is available when the diagnostics
page itself needs tunnel coverage.
It requires a fresh increment from every application runtime on the exercised path: Voice Edge
(`voice.session`), Inference Broker (`inference.pi`), Pi Voice Service (`pi.turn`), and Agent Gateway
(`task.propose`). It also requires the `component.started` lifecycle series from those services plus
the Pi Task Worker, Image Builder manager, and native Gitea builder runner. A stale operation metric from an earlier run cannot satisfy
the exercised-path gate.

Verify durable results without displaying capabilities:

```bash
docker compose --env-file deploy/.env \
  -f deploy/compose.yml -f deploy/compose.local-test.yml \
  exec -T postgres psql -U voice_agents -d voice_agents -P pager=off \
  -c "SELECT id, identity, workspace, status, task_id, created_at FROM voice_task_proposals ORDER BY created_at DESC LIMIT 5"
```

Expected security properties:

- a proposal is `pending` in Postgres before a later explicit approval;
- “propose and approve” in one turn remains pending;
- approval creates one Pi Durable task id and does not expose the signed approval token to voice-edge;
- missing/replayed session tokens and hostile origins fail the WebSocket handshake;
- missing gateway bearer credentials return 401, wrong identities return 403, and workspace escapes
  return 400;
- malformed audio and oversized broker requests are rejected before model execution;
- owner/provider failures remain durable in Pi Durable SQLite and never cause an unsandboxed
  fallback.

The test is deliberately exploratory: inspect transcript segmentation and the exact plan persisted
by the LLM, and vary silence, clipping, identity, origin, workspace, and approval phrasing. A
successful transport test does not imply a successful agent run; Pi provider login remains a
separate host prerequisite documented in
[HOST_REQUIREMENTS.md](HOST_REQUIREMENTS.md).
