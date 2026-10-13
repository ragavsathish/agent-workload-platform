#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose=(docker compose --env-file "$root/server/.env" -f "$root/deploy/compose.yml")
failures=0
pass() { printf 'PASS  %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; failures=$((failures + 1)); }

services=(s3mock postgres otel-lgtm agent-gateway tailscale voice-edge)
secure_services=(s3mock agent-gateway tailscale voice-edge)
no_log_services=(otel-lgtm agent-gateway voice-edge)

for service in "${services[@]}"; do
  cid="$("${compose[@]}" ps -q "$service")"
  if [[ -n "$cid" && "$(docker inspect -f '{{.State.Running}}' "$cid")" == true ]]; then
    pass "$service is running"
  else
    fail "$service is not running"
  fi
done

for service in "${secure_services[@]}"; do
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

for service in "${no_log_services[@]}"; do
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
gateway_ports="$(docker inspect -f '{{json .NetworkSettings.Ports}}' "$("${compose[@]}" ps -q agent-gateway)")"
if [[ "$gateway_ports" == *'"9444/tcp":[{"HostIp":"127.0.0.1"'* ]]; then
  pass "agent gateway is published only on host loopback for native Pi voice"
else
  fail "agent gateway loopback publication is missing"
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
import json
import os
import urllib.error
import urllib.request


def rejected(headers: dict[str, str]) -> bool:
    request = urllib.request.Request(
        "http://127.0.0.1:7860/api/offer",
        data=json.dumps({"sdp": "invalid", "type": "offer"}).encode(),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        urllib.request.urlopen(request, timeout=5)
    except urllib.error.HTTPError as exc:
        return exc.code == 403
    return False


origin = os.environ["PIPECAT_ALLOWED_ORIGINS"].split(",", 1)[0]
identity = os.environ["EDGE_ALLOWED_USERS"].split(",", 1)[0]
assert rejected({"Origin": origin})
assert rejected({"Origin": origin, "tailscale-user-login": "attacker@example.invalid"})
assert rejected({"Origin": "https://attacker.invalid", "tailscale-user-login": identity})
PY
then
  pass "SmallWebRTC signaling requires the exact Tailscale identity and browser origin"
else
  fail "SmallWebRTC signaling identity/origin checks are not enforced"
fi

serve_status="$("${compose[@]}" exec -T tailscale tailscale --socket=/tmp/tailscaled.sock serve status 2>/dev/null || true)"
if [[ "$serve_status" == *'https://'* && "$serve_status" == *'http://127.0.0.1:7860'* && "$serve_status" == *':8443'* && "$serve_status" == *'http://otel-lgtm:3000'* ]]; then
  pass "Tailscale Serve exposes Pipecat and identity-authenticated Grafana only to the tailnet"
else
  fail "Tailscale Serve Pipecat/Grafana HTTPS proxies are not configured"
fi

tailnet_dns="$("${compose[@]}" exec -T tailscale tailscale --socket=/tmp/tailscaled.sock status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
tailnet_ip="$("${compose[@]}" exec -T tailscale tailscale --socket=/tmp/tailscaled.sock ip -4)"
if "${compose[@]}" exec -T voice-edge /app/.venv/bin/python - "$tailnet_dns" "$tailnet_ip" <<'PY'
import json
import os
import socket
import sys
import urllib.request

name, address = sys.argv[1:]
owner = os.environ["EDGE_ALLOWED_USERS"].split(",", 1)[0].strip().lower()
original = socket.getaddrinfo


def resolve(host, port, *args, **kwargs):
    return original(address if host == name else host, port, *args, **kwargs)


socket.getaddrinfo = resolve
request = urllib.request.Request(
    f"https://{name}:8443/api/user",
    headers={"Tailscale-User-Login": "attacker@example.invalid"},
)
with urllib.request.urlopen(request, timeout=10) as response:
    payload = json.load(response)
assert response.status == 200
assert payload["login"].lower() == owner
with urllib.request.urlopen(
    f"https://{name}:8443/api/dashboards/uid/pipecat-voice-overview", timeout=10
) as response:
    dashboard = json.load(response)
assert response.status == 200
assert dashboard["dashboard"]["title"] == "Pipecat Voice Health"
PY
then
  pass "Grafana trusts the Tailscale owner and serves the dashboard without a password"
else
  fail "Grafana did not accept the Tailscale-injected owner identity"
fi

if "${compose[@]}" exec -T agent-gateway /app/.venv/bin/python - <<'PY'
import urllib.error
import urllib.request

request = urllib.request.Request(
    "http://otel-lgtm:3000/api/user",
    headers={"Tailscale-User-Login": "attacker@example.invalid"},
)
try:
    urllib.request.urlopen(request, timeout=5)
except urllib.error.HTTPError as error:
    assert error.code == 401
else:
    raise AssertionError("Grafana accepted a forged identity header")
PY
then
  pass "Grafana rejects a forged identity header outside the Tailscale ingress"
else
  fail "Grafana accepted a forged identity header outside the Tailscale ingress"
fi

[[ "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:9443/health || true)" == 401 ]] && pass "host inference broker rejects unauthenticated traffic" || fail "host inference broker capability check failed"
[[ "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:9446/health || true)" == 401 ]] && pass "Pi voice service rejects unauthenticated traffic" || fail "Pi voice service capability check failed"
[[ "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:9444/health || true)" == 401 ]] && pass "loopback agent gateway rejects unauthenticated traffic" || fail "loopback agent gateway capability check failed"
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

for label in com.sathish.pipecat-broker com.sathish.pipecat-pi-voice com.sathish.pipecat-worker; do
  launchctl print "gui/$UID/$label" >/dev/null 2>&1 && pass "$label is loaded" || fail "$label is not loaded"
done

state="$("${compose[@]}" exec -T tailscale tailscale --socket=/tmp/tailscaled.sock status --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("BackendState", "unknown"))' 2>/dev/null || true)"
[[ "$state" == Running ]] && pass "Tailscale is authenticated" || warn "Tailscale state is ${state:-unknown}; run make login"

(( failures == 0 )) || { echo "$failures verification check(s) failed" >&2; exit 1; }
echo "Compose isolation verification passed."
