#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
wifi_device="$(networksetup -listallhardwareports | awk '/Hardware Port: Wi-Fi/{getline; sub(/^Device: /, ""); print; exit}')"
lan_ip="${LAN_BIND_IP:-$(ipconfig getifaddr "$wifi_device" 2>/dev/null || true)}"
lan_port="${LAN_HTTPS_PORT:-8443}"

[[ "$lan_ip" =~ ^10\.|^192\.168\.|^172\.(1[6-9]|2[0-9]|3[01])\. ]] || {
  echo "Refusing to bind: $lan_ip is not a detected RFC1918 Wi-Fi address" >&2
  exit 1
}
[[ "$lan_port" =~ ^[0-9]+$ && "$lan_port" -ge 1024 && "$lan_port" -le 65535 ]] || {
  echo "LAN_HTTPS_PORT must be an unprivileged TCP port" >&2
  exit 1
}

export LAN_BIND_IP="$lan_ip"
export LAN_HTTPS_PORT="$lan_port"
export LAN_ORIGIN="https://$lan_ip:$lan_port"

lan_identity="$(sed -n 's/^ORCHESTRATOR_ALLOWED_USERS=//p' "$root/server/.env" | tail -1)"
if [[ -z "$lan_identity" ]]; then
  lan_identity="$(sed -n 's/^EDGE_ALLOWED_USERS=//p' "$root/edge/.env" | tail -1)"
fi
[[ -n "$lan_identity" && "$lan_identity" != *,* ]] || {
  echo "LAN mode requires exactly one configured edge/orchestrator identity" >&2
  exit 1
}
export LAN_IDENTITY="$lan_identity"
export ORCHESTRATOR_ALLOWED_USERS="$lan_identity"

password_file="$root/deploy/secrets/lan-password"
hash_file="$root/deploy/secrets/lan-password-hash"
if [[ ! -s "$password_file" ]]; then
  umask 077
  openssl rand -base64 24 | tr -d '\n' > "$password_file"
  printf '\n' >> "$password_file"
fi
password="$(<"$password_file")"
if [[ ! -s "$hash_file" ]]; then
  printf '%s\n%s\n' "$password" "$password" \
    | docker run --rm -i --network none \
      caddy:2.11.6-alpine@sha256:d44355d3c2149dc580ce2cac735955d1c08d3d00882c30489c241aa51a5c10d9 \
      caddy hash-password 2>/dev/null > "$hash_file"
  chmod 600 "$hash_file"
fi
export LAN_BASIC_AUTH_HASH="$(<"$hash_file")"
compose=(docker compose --env-file "$root/server/.env" -f "$root/deploy/compose.yml" -f "$root/deploy/compose.lan.yml")

"${compose[@]}" up -d --wait --build --force-recreate tailscale voice-edge lan-proxy

client_dir="$root/deploy/lan-client"
mkdir -p "$client_dir"
chmod 700 "$client_dir"
cid="$("${compose[@]}" ps -q lan-proxy)"
docker cp "$cid:/data/caddy/pki/authorities/local/root.crt" "$client_dir/pipecat-lan-root.crt"
chmod 644 "$client_dir/pipecat-lan-root.crt"
printf '%s\n' "$LAN_ORIGIN" > "$client_dir/url"

[[ "$(docker inspect -f '{{.HostConfig.LogConfig.Type}}' "$cid")" == none ]]
[[ "$(docker inspect -f '{{json .HostConfig.CapDrop}}' "$cid")" == '["ALL"]' ]]
[[ "$(docker inspect -f '{{json .HostConfig.CapAdd}}' "$cid")" == '["NET_BIND_SERVICE"]' ]]
docker inspect -f '{{json .HostConfig.SecurityOpt}}' "$cid" | grep -q 'no-new-privileges'
tailscale_cid="$("${compose[@]}" ps -q tailscale)"
docker inspect -f '{{json .NetworkSettings.Ports}}' "$tailscale_cid" \
  | grep -Fq "\"HostIp\":\"$lan_ip\",\"HostPort\":\"$lan_port\""
curl --fail --silent --show-error \
  --cacert "$client_dir/pipecat-lan-root.crt" \
  --user "lan:$password" \
  "$LAN_ORIGIN/api/features" >/dev/null
[[ "$(curl --silent --output /dev/null --write-out '%{http_code}' --cacert "$client_dir/pipecat-lan-root.crt" "$LAN_ORIGIN/api/features")" == 401 ]]

echo "Voice UI: $LAN_ORIGIN"
echo "Public CA certificate: $client_dir/pipecat-lan-root.crt"
echo "PASS private-address HTTPS, certificate, and container isolation checks"
echo "LAN user: lan (run make lan-password to reveal the generated password)"
echo "Run ./scripts/lan-iphone-setup.sh for the guided iPhone trust setup."
