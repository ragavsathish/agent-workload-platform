# Sandboxed trace render worker

This container is the only runtime allowed to execute `playwright-recast`, FFmpeg, and FFprobe for
narrated Playwright exports. The host Trace Viewer sends a selected opaque trace to its loopback API;
the worker stores the trace, job state, log, manifest, and MP4 under
`s3://$ARTIFACT_BUCKET/trace-renders/{renderId}/`.

The Compose service runs as UID/GID 65532 with a read-only root filesystem, tmpfs scratch space,
all capabilities dropped, `no-new-privileges`, and no host trace/output mounts or Docker socket. It
can reach only the S3-compatible artifact store and the loopback inference broker route. The broker
token is a read-only container secret and is never exposed to Wassette or the voice VM.

The worker serializes renders. Pending or running S3 jobs are recovered after restart. S3Mock is the
local contract test; replace its endpoint and credentials with durable S3-compatible storage for
production.

Payload-free OpenTelemetry records submission/recovery counts, render outcome and duration, and a
render span under service name `playwright-trace-render-worker`. Structured Docker logs contain only
event names and opaque IDs; renderer output is bounded to 64 KiB in the private S3 prefix.

```bash
docker compose -f products/voice-agent/deploy/compose.yml up -d --build trace-render-worker
curl --fail http://127.0.0.1:9460/health
```
