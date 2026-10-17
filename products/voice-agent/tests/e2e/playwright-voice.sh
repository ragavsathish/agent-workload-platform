#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose=(
  docker compose
  --env-file "$repo_dir/deploy/.env"
  -f "$repo_dir/deploy/compose.yml"
  -f "$repo_dir/deploy/compose.playwright.yml"
  --profile e2e
)
audio_file="$(mktemp -t voice-e2e).wav"
output_dir="${PLAYWRIGHT_OUTPUT_DIR:-/tmp/pipecat-playwright-voice}"

cleanup() {
  PLAYWRIGHT_AUDIO_FILE="$audio_file" PLAYWRIGHT_OUTPUT_DIR="$output_dir" \
    "${compose[@]}" rm -s -f e2e-tailnet-bridge >/dev/null 2>&1 || true
  unlink "$audio_file" 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$output_dir"
ffmpeg -hide_banner -loglevel error \
  -f lavfi -t 10 -i anullsrc=r=16000:cl=mono \
  -i "$repo_dir/deploy/secrets/voxlock-voice-sample.wav" \
  -filter_complex '[1:a]volume=12dB[voice];[0:a][voice]concat=n=2:v=0:a=1[out]' \
  -map '[out]' -c:a pcm_s16le -ar 16000 -ac 1 -y "$audio_file"

export PLAYWRIGHT_AUDIO_FILE="$audio_file"
export PLAYWRIGHT_OUTPUT_DIR="$output_dir"
GRAFANA_TRACE_ID="$(python3 "$repo_dir/tests/e2e/grafana-mcp.py" | jq -r '.traceId')"
test -n "$GRAFANA_TRACE_ID" && test "$GRAFANA_TRACE_ID" != null
export GRAFANA_TRACE_ID

"${compose[@]}" up -d --no-deps e2e-tailnet-bridge
"${compose[@]}" run --rm --no-deps playwright-e2e
