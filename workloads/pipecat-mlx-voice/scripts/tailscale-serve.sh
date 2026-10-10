#!/bin/sh
set -eu

if ! command -v tailscale >/dev/null 2>&1; then
  echo "Tailscale is not installed. Install it from https://tailscale.com/download/mac" >&2
  exit 1
fi

if ! tailscale status >/dev/null 2>&1; then
  echo "Tailscale is not connected. Open the macOS app and sign in first." >&2
  exit 1
fi

# Serve is tailnet-only. Do not replace this with `tailscale funnel`.
tailscale serve --bg http://127.0.0.1:7860
tailscale serve status
