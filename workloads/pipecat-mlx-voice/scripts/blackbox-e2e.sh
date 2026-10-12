#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
identity="${BLACKBOX_IDENTITY:-you@example.com}"
compose=(docker compose --env-file "$repo_dir/server/.env" -f "$repo_dir/deploy/compose.yml" -f "$repo_dir/deploy/compose.local-test.yml")

ORCHESTRATOR_ALLOWED_USERS="$identity" \
  "${compose[@]}" up -d --wait --build tailscale s3mock postgres agent-gateway voice-edge >/dev/null

before="$("${compose[@]}" exec -T postgres psql -U voice_agents -d voice_agents -Atc \
  "SELECT count(*) FROM voice_task_proposals")"
result_file="$(mktemp -t pipecat-blackbox.XXXXXX)"
trap 'rm -f "$result_file"' EXIT

BLACKBOX_SKIP_UP=true "$repo_dir/scripts/blackbox-voice.sh" \
  "Propose a task in the default workspace to report voice black box complete without changing files" \
  >"$result_file"
cat "$result_file"

after="$("${compose[@]}" exec -T postgres psql -U voice_agents -d voice_agents -Atc \
  "SELECT count(*) FROM voice_task_proposals")"
[[ "$after" -eq $((before + 1)) ]] || {
  echo "FAIL expected one new Postgres proposal; before=$before after=$after" >&2
  exit 1
}

latest="$("${compose[@]}" exec -T postgres psql -U voice_agents -d voice_agents -Atc \
  "SELECT identity || '|' || status || '|' || workspace FROM voice_task_proposals ORDER BY created_at DESC LIMIT 1")"
IFS='|' read -r actual_identity status workspace <<<"$latest"
expected_workspace="$(sed -n 's/^VOICE_DEFAULT_WORKSPACE=//p' "$repo_dir/server/.env" | tail -1)"
[[ "$actual_identity" == "$identity" ]] || { echo "FAIL persisted identity mismatch" >&2; exit 1; }
[[ "$status" == "pending" ]] || { echo "FAIL proposal should remain pending" >&2; exit 1; }
expected_prefix="s3://agent-artifacts/workspaces/$expected_workspace/sources/"
[[ "$workspace" == "$expected_prefix"*.bundle ]] || { echo "FAIL persisted immutable workspace mismatch" >&2; exit 1; }
echo "PASS synthetic voice created one pending, identity-bound Postgres proposal"
"$repo_dir/scripts/otel-smoke-test.sh"
