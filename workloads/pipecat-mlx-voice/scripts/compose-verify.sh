#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose=(docker compose --env-file "$root/server/.env" -f "$root/deploy/compose.yml")
failures=0
pass() { printf 'PASS  %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; failures=$((failures + 1)); }

for service in s3mock postgres agent-gateway tailscale voice-edge; do
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
if docker inspect -f '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}' "$("${compose[@]}" ps -q s3mock)" | grep -q '/Documents'; then
  fail "S3Mock binds a Documents path"
else
  pass "S3Mock uses no Documents bind mount"
fi
[[ -z "$(docker port "$("${compose[@]}" ps -q tailscale)" 2>/dev/null)" ]] && pass "voice/Tailscale namespace publishes no Docker port" || fail "voice/Tailscale publishes a Docker port"

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
