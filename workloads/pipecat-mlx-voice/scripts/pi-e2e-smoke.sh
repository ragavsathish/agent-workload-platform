#!/usr/bin/env bash
set -euo pipefail

# Smoke-test the native Pi path without starting or mutating any service.
# The request is intentionally deterministic and the response is not printed;
# transcripts may contain private conversation content.

runtime_dir="${PIPECAT_RUNTIME_DIR:-$HOME/Library/Application Support/PipecatEdge}"
env_file="${PI_VOICE_ENV_FILE:-$runtime_dir/server/broker.env}"
broker_url="${INFERENCE_BROKER_BASE_URL:-http://127.0.0.1:9443/v1}"
broker_url="${broker_url%/}"

if [[ -z "${INFERENCE_BROKER_TOKEN:-}" ]]; then
  [[ -r "$env_file" ]] || {
    echo "FAIL missing broker environment file: $env_file" >&2
    exit 1
  }
  INFERENCE_BROKER_TOKEN="$(sed -n 's/^INFERENCE_BROKER_TOKEN=//p' "$env_file" | tail -1 | tr -d '\"')"
fi

[[ ${#INFERENCE_BROKER_TOKEN} -ge 32 ]] || {
  echo "FAIL INFERENCE_BROKER_TOKEN is missing or too short" >&2
  exit 1
}

tmp_dir="$(mktemp -d -t pi-voice-smoke.XXXXXX)"
trap 'rm -rf "$tmp_dir"' EXIT
auth_header="Authorization: Bearer $INFERENCE_BROKER_TOKEN"

curl --silent --show-error --fail --max-time 5 \
  -H "$auth_header" "$broker_url/../health" >"$tmp_dir/health.json"

curl --silent --show-error --fail --max-time "${PI_VOICE_SMOKE_TIMEOUT_SECONDS:-150}" \
  -H "$auth_header" \
  -H 'Content-Type: application/json' \
  --data '{"model":"pi-agent","messages":[{"role":"user","content":"Reply with the exact token PI_SMOKE_OK and nothing else."}]}' \
  "$broker_url/pi/chat/completions" >"$tmp_dir/completion.json"

curl --silent --show-error --fail --max-time 5 \
  -H "$auth_header" "$broker_url/pi/transcript" >"$tmp_dir/transcript.json"

python3 - "$tmp_dir/health.json" "$tmp_dir/completion.json" "$tmp_dir/transcript.json" <<'PY'
import json
import pathlib
import sys

health = json.loads(pathlib.Path(sys.argv[1]).read_text())
completion = json.loads(pathlib.Path(sys.argv[2]).read_text())
transcript = json.loads(pathlib.Path(sys.argv[3]).read_text())

assert health.get("status") == "ok", f"unexpected health response: {health!r}"
choices = completion.get("choices")
assert isinstance(choices, list) and choices, "Pi returned no completion choices"
message = choices[0].get("message", {})
text = message.get("content") if isinstance(message, dict) else None
assert isinstance(text, str) and text.strip(), "Pi returned empty assistant content"
assert isinstance(transcript.get("revision"), int), "transcript revision is missing"
assert isinstance(transcript.get("entries"), list), "transcript entries are missing"
print(f"PASS native Pi E2E smoke: completion received; transcript revision {transcript['revision']}")
PY
