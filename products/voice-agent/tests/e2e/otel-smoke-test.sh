#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
password_file="$root/deploy/secrets/grafana-admin-password"
[[ -s "$password_file" ]] || { echo "FAIL Grafana credential is missing" >&2; exit 1; }
password="$(<"$password_file")"
query='sum(pipecat_operation_total{service_namespace="pipecat-mlx-voice"})'

for _ in {1..12}; do
  response="$(curl --fail --silent --show-error \
    --user "admin:$password" \
    --get \
    --data-urlencode "query=$query" \
    http://127.0.0.1:3300/api/datasources/proxy/uid/prometheus/api/v1/query || true)"
  if RESPONSE="$response" python3 - <<'PY'
import json
import os

try:
    result = json.loads(os.environ["RESPONSE"])["data"]["result"]
    raise SystemExit(0 if result and float(result[0]["value"][1]) > 0 else 1)
except (KeyError, TypeError, ValueError, json.JSONDecodeError):
    raise SystemExit(1)
PY
  then
    echo "PASS Grafana can query payload-free Pipecat metrics"
    exit 0
  fi
  sleep 2
done

echo "FAIL no Pipecat metric reached Grafana within 24 seconds" >&2
exit 1
