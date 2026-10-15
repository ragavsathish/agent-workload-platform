# Voice black-box testing

The black-box runner uses no microphone shortcut and no direct STT injection. It asks the native
Kokoro broker to synthesize an utterance, resamples the PCM to browser input format, obtains a
one-use Pipecat session token, and streams 20 ms protobuf audio frames over the browser-facing
WebSocket. The token is carried in the URL path so the test matches the Safari/Tailscale ingress.
The resulting Parakeet v3 MLX transcript drives Ollama and the real gateway.

```bash
make warm-models
make blackbox-e2e
make blackbox-voice \
  UTTERANCE="Propose a task in the default workspace to inspect it without changing files"

# Multiple turns, including approval, can be passed directly:
./tests/e2e/blackbox-voice.sh \
  "Propose a task in the default workspace to report ready without changing files" \
  "Approve that pending task now"
```

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
observability port is published beyond loopback. The end-to-end test also waits for a payload-free
Pipecat metric to become queryable through Grafana.

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
- approval creates one Absurd task id and does not expose the signed approval token to voice-edge;
- missing/replayed session tokens and hostile origins fail the WebSocket handshake;
- missing gateway bearer credentials return 401, wrong identities return 403, and workspace escapes
  return 400;
- malformed audio and oversized broker requests are rejected before model execution;
- worker/provider failures remain durable in the Absurd tables and never cause an unsandboxed
  fallback.

The test is deliberately exploratory: inspect transcript segmentation and the exact plan persisted
by the LLM, and vary silence, clipping, identity, origin, workspace, and approval phrasing. A
successful transport test does not imply a successful agent run; Pi provider login remains a
separate host prerequisite documented in
[HOST_REQUIREMENTS.md](HOST_REQUIREMENTS.md).
