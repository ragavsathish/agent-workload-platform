#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
wifi_device="$(networksetup -listallhardwareports | awk '/Hardware Port: Wi-Fi/{getline; sub(/^Device: /, ""); print; exit}')"
export LAN_BIND_IP="${LAN_BIND_IP:-$(ipconfig getifaddr "$wifi_device" 2>/dev/null || true)}"
export LAN_HTTPS_PORT="${LAN_HTTPS_PORT:-8443}"
export LAN_ORIGIN="https://$LAN_BIND_IP:$LAN_HTTPS_PORT"
export LAN_IDENTITY="$(sed -n 's/^ORCHESTRATOR_ALLOWED_USERS=//p' "$root/server/.env" | tail -1)"
export LAN_BASIC_AUTH_HASH="$(<"$root/deploy/secrets/lan-password-hash")"
lan_compose=(docker compose --env-file "$root/server/.env" -f "$root/deploy/compose.yml" -f "$root/deploy/compose.lan.yml")
base_compose=(docker compose --env-file "$root/server/.env" -f "$root/deploy/compose.yml")

"${lan_compose[@]}" stop lan-proxy
"${lan_compose[@]}" rm -f lan-proxy
"${base_compose[@]}" up -d --wait --force-recreate tailscale voice-edge
echo "LAN HTTPS listener removed; tailnet-only voice mode restored."
