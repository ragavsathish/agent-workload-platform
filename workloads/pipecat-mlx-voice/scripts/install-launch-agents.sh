#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
agents_dir="$HOME/Library/LaunchAgents"
runtime_dir="$HOME/Library/Application Support/PipecatEdge"
gondolin_assets_source="$repo_dir/../../artifacts/gondolin-browser/$(uname -m | sed 's/arm64/aarch64/; s/x86_64/x86_64/')"
gondolin_runtime="$runtime_dir/gondolin-agent"
gondolin_assets_runtime="$runtime_dir/gondolin-assets"
domain="gui/$UID"

mkdir -p \
  "$agents_dir" \
  "$runtime_dir/scripts" \
  "$runtime_dir/server/orchestrator" \
  "$runtime_dir/server/sql" \
  "$gondolin_runtime" \
  "$gondolin_assets_runtime"
install -m 700 "$repo_dir/scripts/host-broker.sh" "$repo_dir/scripts/host-worker.sh" "$runtime_dir/scripts/"
install -m 600 \
  "$repo_dir/server/inference_broker.py" \
  "$repo_dir/server/mlx_tts.py" \
  "$repo_dir/server/telemetry.py" \
  "$repo_dir/server/pyproject.toml" \
  "$repo_dir/server/uv.lock" \
  "$runtime_dir/server/"
install -m 600 "$repo_dir"/server/orchestrator/*.py "$runtime_dir/server/orchestrator/"
install -m 600 "$repo_dir"/server/sql/*.sql "$runtime_dir/server/sql/"
gondolin_deploy="$(mktemp -d "$runtime_dir/gondolin-agent.deploy.XXXXXX")"
trap 'rm -rf "$gondolin_deploy"' EXIT
# Produce a standalone dependency graph instead of copying pnpm links that
# resolve back into the repository (and therefore into protected Documents).
/opt/homebrew/bin/pnpm \
  --dir "$repo_dir/../.." \
  --config.inject-workspace-packages=true \
  --filter @agent-workload-platform/gondolin-browser \
  deploy --prod --ignore-scripts "$gondolin_deploy"
rsync -a --delete "$gondolin_deploy/" "$gondolin_runtime/"
rm -rf "$gondolin_deploy"
trap - EXIT
rsync -a --delete "$gondolin_assets_source/" "$gondolin_assets_runtime/"

awk -F= '/^(INFERENCE_BROKER_TOKEN|BROKER_MAX_AUDIO_BYTES|BROKER_MAX_AUDIO_SECONDS|BROKER_MAX_CHAT_BYTES|BROKER_MAX_TTS_CHARS|OLLAMA_MODEL|OLLAMA_BASE_URL|MLX_STT_MODEL|STT_LANGUAGE|MLX_TTS_MODEL|MLX_TTS_VOICE|MLX_TTS_SPEED|MLX_TTS_LANGUAGE_CODE|MLX_TTS_STREAMING_INTERVAL)=/ {print}' \
  "$repo_dir/server/.env" > "$runtime_dir/server/broker.env"
chmod 600 "$runtime_dir/server/broker.env"
awk -F= '/^(DATABASE_URL|ABSURD_QUEUE|ORCHESTRATOR_APPROVAL_SECRET|ORCHESTRATOR_APPROVAL_TTL_SECONDS|ORCHESTRATOR_ALLOWED_USERS|ORCHESTRATOR_WORKSPACE_ROOTS|ORCHESTRATOR_ALLOWED_WORKSPACES|ARTIFACT_ENDPOINT_URL|ARTIFACT_BUCKET|ARTIFACT_ACCESS_KEY|ARTIFACT_SECRET_KEY|WORKER_SCRATCH_ROOT|WORKER_MAX_ARTIFACT_BYTES|PI_BINARY|PI_MODEL|PI_THINKING|PI_SESSION_DIR|WORKER_ALLOW_UNSANDBOXED|WORKER_TASK_TIMEOUT_SECONDS|WORKER_MAX_OUTPUT_BYTES|GITHUB_TOKEN|WASSETTE_BIN|WASSETTE_COMPONENT_DIR|WASSETTE_GITHUB_COMPONENT|WASSETTE_GITHUB_WRITE|MEMORY_FILE_PATH)=/ {print}' \
  "$repo_dir/server/.env" > "$runtime_dir/server/worker.env"
printf 'PI_GONDOLIN_EXTENSION="%s"\nGONDOLIN_BROWSER_ASSETS="%s"\nGONDOLIN_BROWSER_TOOLS=0\nGONDOLIN_MEMORY_TOOLS=0\nPI_CODING_AGENT_DIR="%s"\n' \
  "$gondolin_runtime/dist/pi-extension.js" \
  "$gondolin_assets_runtime" \
  "$HOME/.pi/agent" \
  >> "$runtime_dir/server/worker.env"
chmod 600 "$runtime_dir/server/worker.env"
/opt/homebrew/bin/uv sync --project "$runtime_dir/server" --frozen --no-dev

for label in com.sathish.pipecat-agent-gateway com.sathish.pipecat-edge-machine com.sathish.pipecat-edge-tunnel; do
  launchctl bootout "$domain/$label" >/dev/null 2>&1 || true
  rm -f "$agents_dir/$label.plist"
done

for source in "$repo_dir/deploy/launchd/com.sathish.pipecat-broker.plist" "$repo_dir/deploy/launchd/com.sathish.pipecat-worker.plist"; do
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
  [[ "$loaded" == 1 ]] || { echo "Could not load LaunchAgent $label" >&2; exit 1; }
done

for _ in {1..30}; do
  if [[ "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:9443/health 2>/dev/null || true)" == 401 ]] \
    && launchctl print "$domain/com.sathish.pipecat-worker" >/dev/null 2>&1; then
    echo "Native inference broker and Pi worker converged."
    exit 0
  fi
  sleep 2
done
echo "Native services did not converge" >&2
exit 1
