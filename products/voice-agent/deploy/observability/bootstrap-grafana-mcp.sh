#!/bin/sh
set -eu

umask 077
grafana_url="${GRAFANA_URL:?GRAFANA_URL is required}"
token_file="${GRAFANA_SERVICE_ACCOUNT_TOKEN_FILE:?GRAFANA_SERVICE_ACCOUNT_TOKEN_FILE is required}"
admin_password="$(cat /run/secrets/grafana-admin-password)"

if [ -s "$token_file" ] && curl -fsS \
  -H "Authorization: Bearer $(cat "$token_file")" \
  "$grafana_url/api/user" >/dev/null; then
  exit 0
fi

accounts="$(curl -fsS --user "admin:$admin_password" \
  "$grafana_url/api/serviceaccounts/search?query=agent-workload-platform-mcp")"
account_id="$(printf '%s' "$accounts" | sed -n 's/.*"id":\([0-9][0-9]*\).*"name":"agent-workload-platform-mcp".*/\1/p' | head -1)"

if [ -z "$account_id" ]; then
  created="$(curl -fsS --user "admin:$admin_password" \
    -H 'Content-Type: application/json' \
    -d '{"name":"agent-workload-platform-mcp","role":"Viewer","isDisabled":false}' \
    "$grafana_url/api/serviceaccounts")"
  account_id="$(printf '%s' "$created" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')"
fi

case "$account_id" in
  ''|*[!0-9]*) echo "Grafana service-account bootstrap returned no numeric id" >&2; exit 1 ;;
esac

token_name="mcp-$(date +%s)"
created_token="$(curl -fsS --user "admin:$admin_password" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"$token_name\",\"secondsToLive\":0}" \
  "$grafana_url/api/serviceaccounts/$account_id/tokens")"
token="$(printf '%s' "$created_token" | sed -n 's/.*"key":"\([^"]*\)".*/\1/p')"
[ -n "$token" ] || { echo "Grafana returned no service-account token" >&2; exit 1; }

temporary="$token_file.part"
printf '%s\n' "$token" > "$temporary"
chmod 0444 "$temporary"
mv "$temporary" "$token_file"
