#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose=(docker compose --env-file "$root/deploy/.env" -f "$root/deploy/compose.yml")
failures=0
pass() { printf 'PASS  %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; failures=$((failures + 1)); }

services=(gitea habitat s3mock postgres fluent-bit otel-lgtm agent-gateway tailscale voice-edge traefik)
secure_services=(gitea habitat s3mock fluent-bit agent-gateway tailscale voice-edge traefik)
no_log_services=(otel-lgtm)
bounded_log_services=(gitea habitat fluent-bit agent-gateway voice-edge traefik)

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

for service in "${bounded_log_services[@]}"; do
  cid="$("${compose[@]}" ps -q "$service")"
  [[ "$(docker inspect -f '{{.HostConfig.LogConfig.Type}}' "$cid")" == local ]] && pass "$service retains bounded local stdout" || fail "$service does not use the local logging driver"
  [[ "$(docker inspect -f '{{index .HostConfig.LogConfig.Config "max-size"}}' "$cid")" == 10m ]] && pass "$service stdout size is bounded" || fail "$service stdout size is not bounded"
  [[ "$(docker inspect -f '{{index .HostConfig.LogConfig.Config "max-file"}}' "$cid")" == 3 ]] && pass "$service stdout rotation is bounded" || fail "$service stdout rotation is not bounded"
done

for service in agent-gateway voice-edge; do
  cid="$("${compose[@]}" ps -q "$service")"
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$cid" | grep -Fxq 'OTEL_LOGS_EXPORTER=none' && pass "$service exports no OpenTelemetry logs" || fail "$service OpenTelemetry log export is not disabled"
done

if "${compose[@]}" exec -T voice-edge /app/.venv/bin/python - <<'PY'
import json
import os
import urllib.request

with urllib.request.urlopen("http://127.0.0.1:7860/api/features", timeout=5) as response:
    features = json.load(response)
selected = os.environ.get("VOICE_INPUT_FILTER", "rnnoise")
assert features["audioFilter"]["name"] == selected
assert features["audioFilter"]["ready"] is True
if selected == "voxlock":
    assert os.path.isfile("/run/secrets/voxlock-voice-sample")
    assert os.path.isfile("/app/models/voxlock/enroll.onnx")
    assert os.path.isfile("/app/models/voxlock/chunk_int8.onnx")
PY
then
  pass "voice edge input filter and local model are ready"
else
  fail "voice edge input filter readiness check failed"
fi

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
gitea_cid="$("${compose[@]}" ps -q gitea)"
gitea_ports="$(docker inspect -f '{{json .NetworkSettings.Ports}}' "$gitea_cid")"
if [[ "$gitea_ports" == *'"3000/tcp":[{"HostIp":"127.0.0.1","HostPort":"3001"'* ]]; then
  pass "Gitea is published only on host loopback"
else
  fail "Gitea loopback publication is missing"
fi
habitat_cid="$("${compose[@]}" ps -q habitat)"
[[ -z "$(docker port "$habitat_cid" 2>/dev/null)" ]] \
  && pass "Habitat publishes no Docker port" \
  || fail "Habitat publishes a Docker port"
habitat_password="$(<"$root/deploy/secrets/habitat-database-password")"
habitat_privileges="$(docker exec -e PGPASSWORD="$habitat_password" \
  "$("${compose[@]}" ps -q postgres)" \
  psql -h 127.0.0.1 -U habitat_operator -d voice_agents -Atc \
  "SELECT has_schema_privilege(current_user, 'absurd', 'USAGE'), has_table_privilege(current_user, 'absurd.queues', 'SELECT'), has_table_privilege(current_user, 'voice_task_proposals', 'SELECT')")"
[[ "$habitat_privileges" == "t|t|f" ]] \
  && pass "Habitat can operate the Absurd schema without reading proposal records" \
  || fail "Habitat database privileges exceed or miss the intended queue scope"
if docker inspect -f '{{range .Mounts}}{{println .Type " " .Source " -> " .Destination}}{{end}}' "$gitea_cid" | grep -q ' bind '; then
  fail "Gitea uses a host bind mount"
else
  pass "Gitea persists through named volumes only"
fi
if git ls-remote http://127.0.0.1:3001/source-publisher/agent-workload-platform.git HEAD >/dev/null 2>&1; then
  pass "Gitea serves the committed source mirror without a write credential"
else
  fail "Gitea source mirror is unavailable"
fi
gitea_agent_token_file="$root/deploy/secrets/gitea-agent-token"
if [[ -s "$gitea_agent_token_file" ]]; then
  gitea_agent_token="$(<"$gitea_agent_token_file")"
  gitea_identity="$(curl -fsS -H "Authorization: token $gitea_agent_token" \
    http://127.0.0.1:3001/api/v1/user 2>/dev/null || true)"
  [[ "$gitea_identity" == *'"login":"voice-agent"'* ]] \
    && pass "Gitea Tea token identifies the restricted voice agent" \
    || fail "Gitea Tea token identity is invalid"
  gitea_write_status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
    -H "Authorization: token $gitea_agent_token" \
    -H 'Content-Type: application/json' \
    --data '{}' \
    http://127.0.0.1:3001/api/v1/repos/source-publisher/agent-workload-platform/issues \
    || true)"
  [[ "$gitea_write_status" == 403 ]] \
    && pass "Gitea Tea token cannot mutate issues" \
    || fail "Gitea Tea token is not read-only"
else
  fail "Gitea Tea token is missing"
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
fluent_bit_cid="$("${compose[@]}" ps -q fluent-bit)"
[[ -z "$(docker port "$fluent_bit_cid" 2>/dev/null)" ]] \
  && pass "Fluent Bit publishes no Docker port" \
  || fail "Fluent Bit publishes a Docker port"
fluent_bit_mounts="$(docker inspect -f '{{range .Mounts}}{{println .Source " -> " .Destination " writable=" .RW}}{{end}}' "$fluent_bit_cid")"
if grep -Eq '^/proc +-> +/host/proc +writable= false$' <<<"$fluent_bit_mounts" \
  && grep -Eq '^/sys +-> +/host/sys +writable= false$' <<<"$fluent_bit_mounts"; then
  pass "Fluent Bit reads Docker VM procfs and sysfs read-only"
else
  fail "Fluent Bit system metric mounts are missing or writable"
fi
if "${compose[@]}" exec -T otel-lgtm sh -lc \
  'curl -fsS http://fluent-bit:2021/metrics | grep -q node_memory_MemTotal_bytes'; then
  pass "Fluent Bit exports Docker VM system metrics on the private network"
else
  fail "Fluent Bit system metrics endpoint is unavailable"
fi
if "${compose[@]}" exec -T otel-lgtm sh -lc \
  'curl -fsS '\''http://127.0.0.1:9090/api/v1/query?query=node_memory_MemTotal_bytes%7Bsystem%3D%22docker-desktop-vm%22%7D'\'' | grep -Fq '\''"result":[{'\'''; then
  pass "Prometheus ingests Fluent Bit system metrics"
else
  fail "Prometheus has not ingested Fluent Bit system metrics"
fi
for port in 2022 9465; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | grep -Fq '127.0.0.1:'; then
    pass "native metrics port $port listens only on host loopback"
  else
    fail "native metrics port $port is unavailable or not loopback-only"
  fi
done
curl -fsS http://127.0.0.1:2022/metrics | grep -q 'node_uname_info{system="macos-host"' \
  && pass "native Fluent Bit exports macOS system metrics" \
  || fail "native macOS system metrics endpoint is unavailable"
curl -fsS http://127.0.0.1:9465/metrics | grep -q '^gondolin_vm_count ' \
  && pass "host exporter reports registered Gondolin VMs" \
  || fail "Gondolin VM metrics endpoint is unavailable"
if "${compose[@]}" exec -T otel-lgtm sh -lc \
  'curl -fsS '\''http://127.0.0.1:9090/api/v1/query?query=node_uname_info%7Bsystem%3D%22macos-host%22%7D'\'' | grep -Fq '\''"result":[{'\''' \
  && "${compose[@]}" exec -T otel-lgtm sh -lc \
  'curl -fsS '\''http://127.0.0.1:9090/api/v1/query?query=gondolin_vm_count'\'' | grep -Fq '\''"result":[{'\'''; then
  pass "Prometheus ingests macOS and Gondolin VM metrics"
else
  fail "Prometheus has not ingested every host metric source"
fi
[[ "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3300/api/user || true)" == 401 ]] && pass "Grafana requires authentication" || fail "Grafana authentication check failed"
grafana_env="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$otel_cid")"
if grep -Fxq 'GF_AUTH_PROXY_ENABLED=true' <<<"$grafana_env" \
  && grep -Fxq 'GF_AUTH_PROXY_HEADER_NAME=Tailscale-User-Login' <<<"$grafana_env" \
  && grep -Fxq 'GF_AUTH_PROXY_WHITELIST=172.30.90.2' <<<"$grafana_env" \
  && grep -Fxq 'GF_SERVER_SERVE_FROM_SUB_PATH=true' <<<"$grafana_env"; then
  pass "Grafana trusts only the Tailscale-authorized ingress identity"
else
  fail "Grafana Tailscale ingress identity proxy is not configured"
fi
tailscale_login="$("${compose[@]}" exec -T tailscale sh -lc \
  'tailscale --socket=/tmp/tailscaled.sock status --json | sed -n '\''s/.*"LoginName": *"\([^"]*\)".*/\1/p'\'' | head -1')"
if "${compose[@]}" exec -T voice-edge python -c 'import urllib.error,urllib.request
try:
    urllib.request.urlopen("http://127.0.0.1:8080/", timeout=5)
except urllib.error.HTTPError as exc:
    assert exc.code == 404
else:
    raise AssertionError("identity-free ingress request was forwarded")'; then
  pass "Traefik rejects requests without a Tailscale identity"
else
  fail "Traefik forwarded a request without a Tailscale identity"
fi
if "${compose[@]}" exec -T voice-edge python -c 'import urllib.error,urllib.request
request=urllib.request.Request("http://127.0.0.1:8080/",headers={"Tailscale-User-Login":"attacker@example.invalid"})
try:
    urllib.request.urlopen(request, timeout=5)
except urllib.error.HTTPError as exc:
    assert exc.code == 403
else:
    raise AssertionError("non-owner ingress request was forwarded")'; then
  pass "Traefik requires the exact configured owner identity"
else
  fail "Traefik accepted a non-owner Tailscale identity"
fi
if [[ -n "$tailscale_login" ]] \
  && "${compose[@]}" exec -T tailscale wget -q -O /dev/null \
    --header="Tailscale-User-Login: $tailscale_login" http://127.0.0.1:8080/api/features \
  && "${compose[@]}" exec -T tailscale wget -q -O /dev/null \
    --header="Tailscale-User-Login: $tailscale_login" http://127.0.0.1:8080/metrics/api/user \
  && "${compose[@]}" exec -T tailscale wget -q -O /dev/null \
    --header="Tailscale-User-Login: $tailscale_login" http://127.0.0.1:8080/git/api/v1/version \
  && "${compose[@]}" exec -T tailscale wget -q -O /dev/null \
    --header="Tailscale-User-Login: $tailscale_login" http://127.0.0.1:8080/queue/api/queues; then
  pass "Traefik routes owner-authenticated live, metrics, Git, and queue requests"
else
  fail "Traefik path routing or Tailscale identity forwarding failed"
fi
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
if [[ "$serve_status" == *'https://'* \
  && "$serve_status" == *'http://127.0.0.1:8080'* \
  && "$serve_status" != *':8443'* ]]; then
  pass "Tailscale Serve authorizes one HTTPS origin before Traefik routing"
else
  fail "Tailscale Serve does not point exclusively at Traefik ingress"
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

for label in com.sathish.pipecat-broker com.sathish.pipecat-host-observability com.sathish.pipecat-pi-voice com.sathish.pipecat-worker; do
  launchctl print "gui/$UID/$label" >/dev/null 2>&1 && pass "$label is loaded" || fail "$label is not loaded"
done

state="$("${compose[@]}" exec -T tailscale tailscale --socket=/tmp/tailscaled.sock status --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("BackendState", "unknown"))' 2>/dev/null || true)"
[[ "$state" == Running ]] && pass "Tailscale is authenticated" || warn "Tailscale state is ${state:-unknown}; run make login"

(( failures == 0 )) || { echo "$failures verification check(s) failed" >&2; exit 1; }
echo "Compose isolation verification passed."
