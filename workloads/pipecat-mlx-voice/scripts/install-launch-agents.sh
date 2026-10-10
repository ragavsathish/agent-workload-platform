#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
agents_dir="$HOME/Library/LaunchAgents"
runtime_dir="$HOME/Library/Application Support/PipecatEdge"
domain="gui/$UID"
machine_name="${PODMAN_EDGE_MACHINE:-pipecat-edge}"
edge_was_present=0
podman inspect pipecat-edge-app >/dev/null 2>&1 && edge_was_present=1

mkdir -p "$agents_dir" "$runtime_dir/scripts" "$runtime_dir/deploy" "$runtime_dir/server"
install -m 700 \
  "$repo_dir/scripts/host-broker.sh" \
  "$repo_dir/scripts/podman-edge-create.sh" \
  "$repo_dir/scripts/podman-edge-keepalive.sh" \
  "$repo_dir/scripts/podman-edge-ssh.sh" \
  "$repo_dir/scripts/podman-edge-tunnel.sh" \
  "$runtime_dir/scripts/"
install -m 600 "$repo_dir/deploy/podman-containers.conf" "$runtime_dir/deploy/"
install -m 600 \
  "$repo_dir/server/inference_broker.py" \
  "$repo_dir/server/mlx_tts.py" \
  "$repo_dir/server/pyproject.toml" \
  "$repo_dir/server/uv.lock" \
  "$runtime_dir/server/"

awk -F= '/^(INFERENCE_BROKER_TOKEN|BROKER_MAX_AUDIO_BYTES|BROKER_MAX_AUDIO_SECONDS|BROKER_MAX_CHAT_BYTES|BROKER_MAX_TTS_CHARS|OLLAMA_MODEL|OLLAMA_BASE_URL|MLX_STT_MODEL|STT_LANGUAGE|MLX_TTS_MODEL|MLX_TTS_VOICE|MLX_TTS_SPEED|MLX_TTS_LANGUAGE_CODE|MLX_TTS_STREAMING_INTERVAL)=/ {print}' \
  "$repo_dir/server/.env" > "$runtime_dir/server/broker.env"
chmod 600 "$runtime_dir/server/broker.env"
/opt/homebrew/bin/uv sync --project "$runtime_dir/server" --frozen --no-dev

for source in "$repo_dir"/deploy/launchd/*.plist; do
  target="$agents_dir/$(basename "$source")"
  label="$(/usr/libexec/PlistBuddy -c 'Print :Label' "$source")"
  launchctl bootout "$domain/$label" >/dev/null 2>&1 || true
  install -m 600 "$source" "$target"
  plutil -lint "$target" >/dev/null
  loaded=0
  for _ in {1..5}; do
    if launchctl bootstrap "$domain" "$target" >/dev/null 2>&1; then
      loaded=1
      break
    fi
    sleep 1
  done
  if [[ "$loaded" != "1" ]]; then
    echo "Could not load LaunchAgent $label" >&2
    exit 1
  fi
done

# Replacing the machine keepalive can briefly reset Podman's VM transport.
# Do not report a successful installation until the appliance has converged.
ready=0
for _ in {1..45}; do
  if [[ "$(podman machine inspect "$machine_name" --format '{{.State}}' 2>/dev/null || true)" == "running" ]] \
    && [[ "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:9443/health 2>/dev/null || true)" == "401" ]]; then
    if [[ "$edge_was_present" == "0" ]] \
      || { [[ "$(podman inspect pipecat-edge-app --format '{{.State.Running}}' 2>/dev/null || true)" == "true" ]] \
        && [[ "$(podman inspect pipecat-tailscale --format '{{.State.Running}}' 2>/dev/null || true)" == "true" ]]; }; then
      ready=1
      break
    fi
  fi
  sleep 2
done
[[ "$ready" == "1" ]] || { echo "LaunchAgents loaded, but host services did not converge" >&2; exit 1; }

launchctl print "$domain/com.sathish.pipecat-edge-machine" | head -20
launchctl print "$domain/com.sathish.pipecat-broker" | head -20
launchctl print "$domain/com.sathish.pipecat-edge-tunnel" | head -20
