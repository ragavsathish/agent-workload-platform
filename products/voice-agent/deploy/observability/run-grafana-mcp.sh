#!/bin/sh
set -eu

export MCP_GRAFANA_SERVER_TOKEN="$(cat /run/secrets/grafana-mcp-caller-token)"

exec /app/mcp-grafana \
  --transport streamable-http \
  --address 0.0.0.0:8000 \
  --allowed-hosts 127.0.0.1:8000,localhost:8000,grafana-mcp:8000 \
  --healthz-address 0.0.0.0:8080 \
  --metrics \
  --metrics-address 0.0.0.0:9090 \
  --enabled-tools search,datasource,prometheus,dashboard,navigation,tempo,user \
  --disable-write \
  --usage-stats disabled \
  --slow-request-threshold 2s
