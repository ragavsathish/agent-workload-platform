#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose=(docker compose --env-file "$root/server/.env" -f "$root/deploy/compose.yml")
failures=0
pass() { printf 'PASS  %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; failures=$((failures + 1)); }

for service in s3mock postgres otel-lgtm agent-gateway tailscale voice-edge; do
  cid="$("${compose[@]}" ps -q "$service")"
  if [[ -n "$cid" && "$(docker inspect -f '{{.State.Running}}' "$cid")" == true ]]; then
    pass "$service is running"
  else
    fail "$service is not running"
  fi
done

for service in s3mock agent-gateway tailscale voice-edge; do
  cid="$("${compose[@]}" ps -q "$service")"
  [[ "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$cid")" == true ]] && pass "$service root filesystem is read-only" || fail "$service root filesystem is writable"
  [[ "$(docker inspect -f '{{json .HostConfig.CapDrop}}' "$cid")" == '["ALL"]' ]] && pass "$service drops all capabilities" || fail "$service does not drop all capabilities"
  docker inspect -f '{{json .HostConfig.SecurityOpt}}' "$cid" | grep -q 'no-new-privileges' && pass "$service forbids privilege escalation" || fail "$service permits privilege escalation"
  docker inspect -f '{{range .Mounts}}{{println .Destination}}{{end}}' "$cid" | grep -Fxq /var/run/docker.sock && fail "$service has the Docker socket" || pass "$service has no Docker socket"
done

otel_cid="$("${compose[@]}" ps -q otel-lgtm)"
[[ "$(docker inspect -f '{{json .HostConfig.CapDrop}}' "$otel_cid")" == '["ALL"]' ]] && pass "otel-lgtm drops all capabilities" || fail "otel-lgtm does not drop all capabilities"
docker inspect -f '{{json .HostConfig.SecurityOpt}}' "$otel_cid" | grep -q 'no-new-privileges' && pass "otel-lgtm forbids privilege escalation" || fail "otel-lgtm permits privilege escalation"
docker inspect -f '{{range .Mounts}}{{println .Destination}}{{end}}' "$otel_cid" | grep -Fxq /var/run/docker.sock && fail "otel-lgtm has the Docker socket" || pass "otel-lgtm has no Docker socket"

for service in otel-lgtm agent-gateway voice-edge; do
  cid="$("${compose[@]}" ps -q "$service")"
  [[ "$(docker inspect -f '{{.HostConfig.LogConfig.Type}}' "$cid")" == none ]] && pass "$service retains no Docker logs" || fail "$service Docker logging is enabled"
done

for service in agent-gateway voice-edge; do
  cid="$("${compose[@]}" ps -q "$service")"
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$cid" | grep -Fxq 'OTEL_LOGS_EXPORTER=none' && pass "$service exports no OpenTelemetry logs" || fail "$service OpenTelemetry log export is not disabled"
done

published="$("${compose[@]}" ps --format json | sed -n 's/.*"Publishers":\[\([^]]*\)\].*/\1/p')"
if docker inspect -f '{{json .NetworkSettings.Ports}}' "$("${compose[@]}" ps -q postgres)" | grep -q '127.0.0.1'; then
  pass "Postgres is published only on host loopback"
else
  fail "Postgres loopback publication is missing"
fi
if docker inspect -f '{{json .NetworkSettings.Ports}}' "$("${compose[@]}" ps -q s3mock)" | grep -q '127.0.0.1'; then
  pass "S3Mock is published only on host loopback"
else
  fail "S3Mock loopback publication is missing"
fi
otel_ports="$(docker inspect -f '{{json .NetworkSettings.Ports}}' "$otel_cid")"
if [[ "$otel_ports" == *'"3000/tcp":[{"HostIp":"127.0.0.1"'* && "$otel_ports" == *'"4318/tcp":[{"HostIp":"127.0.0.1"'* ]]; then
  pass "Grafana and OTLP/HTTP are published only on host loopback"
else
  fail "observability loopback publications are missing"
fi
[[ "$otel_ports" != *'4317/tcp":[* && "$otel_ports" != *'9090/tcp":[* && "$otel_ports" != *'3100/tcp":[* ]] && pass "collector backends publish no extra host ports" || fail "collector backend ports are exposed"
[[ "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3300/api/user || true)" == 401 ]] && pass "Grafana requires authentication" || fail "Grafana authentication check failed"
if docker inspect -f '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}' "$("${compose[@]}" ps -q s3mock)" | grep -q '/Documents'; then
  fail "S3Mock binds a Documents path"
else
  pass "S3Mock uses no Documents bind mount"
fi
tailscale_cid="$("${compose[@]}" ps -q tailscale)"
voice_ports="$(docker inspect -f '{{json .NetworkSettings.Ports}}' "$tailscale_cid")"
[[ -z "$(docker port "$tailscale_cid" 2>/dev/null)" && "$voice_ports" != *'"0.0.0.0"'* && "$voice_ports" != *'"::"'* ]] && pass "voice/Tailscale namespace publishes no Docker port" || fail "voice/Tailscale publishes a Docker port"

if "${compose[@]}" exec -T voice-edge /app/.venv/bin/python - <<'PY'
import asyncio
import json
import os
import urllib.request

import websockets


async def probe() -> None:
    assert os.environ["PIPECAT_WEBSOCKET_AUTH"] == "token"
    origin = os.environ["PIPECAT_ALLOWED_ORIGINS"]
    request = urllib.request.Request(
        "http://127.0.0.1:7860/start",
        data=b'{"transport":"websocket"}',
        headers={"Content-Type": "application/json", "Origin": origin},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        token = json.load(response)["token"]
    async with websockets.connect(
        f"ws://127.0.0.1:7860/ws-client/{token}",
        origin=origin,
        open_timeout=5,
    ) as socket:
        await asyncio.sleep(0.2)
        assert socket.close_code is None
    try:
        async with websockets.connect(
            "ws://127.0.0.1:7860/ws-client",
            origin=origin,
            open_timeout=5,
        ):
            pass
    except websockets.InvalidStatus as exc:
        assert exc.response.status_code == 403
    else:
        raise AssertionError("missing WebSocket token was accepted")
    with urllib.request.urlopen(request, timeout=5) as response:
        hostile_origin_token = json.load(response)["token"]
    try:
        async with websockets.connect(
            f"ws://127.0.0.1:7860/ws-client/{hostile_origin_token}",
            origin="https://attacker.invalid",
            open_timeout=5,
        ):
            pass
    except websockets.InvalidStatus as exc:
        assert exc.response.status_code == 403
    else:
        raise AssertionError("hostile WebSocket origin was accepted")


asyncio.run(probe())
PY
then
  pass "voice WebSocket uses a path token compatible with Tailscale TCP ingress"
else
  fail "voice WebSocket path-token ingress is not enforced"
fi

[[ "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:9443/health || true)" == 401 ]] && pass "host inference broker rejects unauthenticated traffic" || fail "host inference broker capability check failed"
broker_ready=0
gateway_ready=0
for _ in {1..5}; do
  if "${compose[@]}" exec -T voice-edge python -c 'import pathlib,urllib.request; t=pathlib.Path("/run/secrets/broker-token").read_text().strip(); r=urllib.request.Request("http://host.docker.internal:9443/health",headers={"Authorization":"Bearer "+t}); assert urllib.request.urlopen(r,timeout=5).status == 200' >/dev/null 2>&1; then
    broker_ready=1
    break
  fi
  sleep 1
done
[[ "$broker_ready" == 1 ]] && pass "voice edge reaches the capability-protected broker" || fail "voice edge cannot reach the broker"
for _ in {1..5}; do
  if "${compose[@]}" exec -T voice-edge python -c 'import pathlib,urllib.request; t=pathlib.Path("/run/secrets/agent-gateway-token").read_text().strip(); r=urllib.request.Request("http://agent-gateway:9444/health",headers={"Authorization":"Bearer "+t}); assert urllib.request.urlopen(r,timeout=5).status == 200' >/dev/null 2>&1; then
    gateway_ready=1
    break
  fi
  sleep 1
done
[[ "$gateway_ready" == 1 ]] && pass "voice edge reaches the capability-protected gateway" || fail "voice edge cannot reach the agent gateway"
if "${compose[@]}" exec -T agent-gateway /app/.venv/bin/python -c 'import os,boto3; from botocore.client import Config; c=boto3.client("s3",endpoint_url=os.environ["ARTIFACT_ENDPOINT_URL"],aws_access_key_id=os.environ["ARTIFACT_ACCESS_KEY"],aws_secret_access_key=os.environ["ARTIFACT_SECRET_KEY"],region_name="us-east-1",config=Config(s3={"addressing_style":"path"},response_checksum_validation="when_required")); c.head_bucket(Bucket=os.environ["ARTIFACT_BUCKET"])' >/dev/null 2>&1; then
  pass "gateway reaches the private artifact bucket"
else
  fail "gateway cannot reach the private artifact bucket"
fi

for label in com.sathish.pipecat-broker com.sathish.pipecat-worker; do
  launchctl print "gui/$UID/$label" >/dev/null 2>&1 && pass "$label is loaded" || fail "$label is not loaded"
done

state="$("${compose[@]}" exec -T tailscale tailscale --socket=/tmp/tailscaled.sock status --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("BackendState", "unknown"))' 2>/dev/null || true)"
[[ "$state" == Running ]] && pass "Tailscale is authenticated" || warn "Tailscale state is ${state:-unknown}; run make login"

(( failures == 0 )) || { echo "$failures verification check(s) failed" >&2; exit 1; }
echo "Compose isolation verification passed."
