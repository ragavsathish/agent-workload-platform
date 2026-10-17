#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
output_dir="${PLAYWRIGHT_OUTPUT_DIR:-/tmp/pipecat-grafana}"
audio_file="$repo_dir/deploy/secrets/voxlock-voice-sample.wav"
compose=(
  docker compose
  --env-file "$repo_dir/deploy/.env"
  -f "$repo_dir/deploy/compose.yml"
  -f "$repo_dir/deploy/compose.playwright.yml"
  --profile e2e
)

cleanup() {
  PLAYWRIGHT_AUDIO_FILE="$audio_file" PLAYWRIGHT_OUTPUT_DIR="$output_dir" \
    "${compose[@]}" rm -s -f e2e-tailnet-bridge >/dev/null 2>&1 || true
}
trap cleanup EXIT

mkdir -p "$output_dir"
export PLAYWRIGHT_AUDIO_FILE="$audio_file"
export PLAYWRIGHT_OUTPUT_DIR="$output_dir"

"${compose[@]}" up -d --no-deps e2e-tailnet-bridge
"${compose[@]}" run --rm --no-deps \
  -e PLAYWRIGHT_PROJECT=grafana \
  playwright-e2e
