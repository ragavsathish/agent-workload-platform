#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
password_file="$root/deploy/secrets/grafana-admin-password"
[[ -s "$password_file" ]] || { echo "FAIL Grafana credential is missing" >&2; exit 1; }
password="$(<"$password_file")"
query='sum by (service_name, app_operation) (pipecat_operation_total{service_namespace="pipecat-mlx-voice"}) or label_replace(sum by (service_name) (gitea_runner_info{service_name="pipecat-gitea-runner"}), "app_operation", "component.started", "service_name", ".*")'

fetch_metrics() {
  curl --fail --silent --show-error \
    --user "admin:$password" \
    --get \
    --data-urlencode "query=$query" \
    http://127.0.0.1:3300/api/datasources/proxy/uid/prometheus/api/v1/query
}

metrics_json() {
  RESPONSE="$1" python3 - <<'PY'
import json
import os

response = json.loads(os.environ["RESPONSE"])
values = {}
for result in response["data"]["result"]:
    metric = result.get("metric", {})
    service = metric.get("service_name")
    operation = metric.get("app_operation")
    if service and operation:
        values[f"{service}|{operation}"] = float(result["value"][1])
print(json.dumps(values, sort_keys=True))
PY
}

mode="${1:-verify}"
if [[ "$mode" == "snapshot" ]]; then
  metrics_json "$(fetch_metrics)"
  exit 0
fi
[[ "$mode" == "verify" ]] || { echo "usage: $0 [snapshot|verify [baseline.json]]" >&2; exit 2; }

baseline='{}'
if [[ -n "${2:-}" ]]; then
  [[ -s "$2" ]] || { echo "FAIL OTel baseline is missing: $2" >&2; exit 1; }
  baseline="$(<"$2")"
fi

last_missing=""
for _ in {1..15}; do
  response="$(fetch_metrics || true)"
  if [[ -n "$response" ]]; then
    current="$(metrics_json "$response" 2>/dev/null || true)"
    if [[ -n "$current" ]]; then
      result="$(BASELINE="$baseline" CURRENT="$current" python3 - <<'PY'
import json
import os

expected = {
    "pipecat-voice-edge|voice.session",
    "pipecat-mlx-inference|inference.pi",
    "pipecat-pi-voice|pi.turn",
    "pipecat-agent-gateway|task.propose",
}
expected_lifecycle = {
    "pipecat-voice-edge|component.started",
    "pipecat-mlx-inference|component.started",
    "pipecat-pi-voice|component.started",
    "pipecat-agent-gateway|component.started",
    "pipecat-task-worker|component.started",
    "pipecat-image-builder|component.started",
    "pipecat-gitea-runner|component.started",
}
baseline = json.loads(os.environ["BASELINE"])
current = json.loads(os.environ["CURRENT"])
missing_fresh = sorted(
    key for key in expected
    if float(current.get(key, 0)) <= float(baseline.get(key, 0))
)
missing_lifecycle = sorted(key for key in expected_lifecycle if float(current.get(key, 0)) <= 0)
problems = []
if missing_fresh:
    problems.append(f"fresh={','.join(missing_fresh)}")
if missing_lifecycle:
    problems.append(f"lifecycle={','.join(missing_lifecycle)}")
print(";".join(problems))
PY
)"
      if [[ -z "$result" ]]; then
        echo "PASS PromQL observed every runtime and fresh E2E metrics from edge, broker, Pi voice, and gateway"
        exit 0
      fi
      last_missing="$result"
    fi
  fi
  sleep 2
done

echo "FAIL PromQL did not observe fresh E2E metrics: ${last_missing:-query unavailable}" >&2
exit 1
