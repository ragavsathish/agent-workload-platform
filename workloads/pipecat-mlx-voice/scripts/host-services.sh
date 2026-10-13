#!/usr/bin/env bash
set -euo pipefail

# One host-only supervisor for the capabilities Docker cannot provide on macOS:
# MLX inference, native Pi/Gondolin, and the durable Pi queue worker.  Compose
# owns every container; this process is the only LaunchAgent that owns host
# processes.
runtime_dir="${PIPECAT_RUNTIME_DIR:-$HOME/Library/Application Support/PipecatEdge}"
scripts_dir="$runtime_dir/scripts"

children=()
stop_children() {
  trap - TERM INT EXIT
  for pid in "${children[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap stop_children TERM INT EXIT

start_child() {
  local name="$1"
  shift
  "$@" &
  children+=("$!")
  echo "$name=$!" >&2
}

start_child broker "$scripts_dir/host-broker.sh"
start_child pi-voice "$scripts_dir/host-pi-voice.sh"
start_child worker "$scripts_dir/host-worker.sh"

while :; do
  for index in "${!children[@]}"; do
    if ! kill -0 "${children[$index]}" 2>/dev/null; then
      echo "host child exited; restarting supervisor" >&2
      exit 1
    fi
  done
  sleep 2
done
