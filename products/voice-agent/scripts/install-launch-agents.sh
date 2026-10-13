#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
agents_dir="$HOME/Library/LaunchAgents"
runtime_dir="$HOME/Library/Application Support/PipecatEdge"
gondolin_assets_source="$repo_dir/../../artifacts/gondolin-browser/$(uname -m | sed 's/arm64/aarch64/; s/x86_64/x86_64/')"
gondolin_runtime="$runtime_dir/gondolin-agent"
voice_agent_runtime="$runtime_dir/voice-pi-agent"
gondolin_assets_runtime="$runtime_dir/gondolin-assets"
stable_skills_dir="$runtime_dir/skills-source"
legacy_skills_dir="$HOME/git/skills"
if [[ -n "${PI_VOICE_SKILLS_SOURCE:-}" ]]; then
  skills_dir="$PI_VOICE_SKILLS_SOURCE"
elif [[ -d "$stable_skills_dir" ]]; then
  skills_dir="$stable_skills_dir"
else
  skills_dir="$legacy_skills_dir"
fi
skills_runtime="$runtime_dir/skills"
domain="gui/$UID"

[[ -d "$skills_dir" ]] || { echo "Missing skills directory: $skills_dir" >&2; exit 1; }

mkdir -p \
  "$agents_dir" \
  "$runtime_dir/scripts" \
  "$runtime_dir/apps/broker/src" \
  "$runtime_dir/apps/worker/src" \
  "$runtime_dir/packages/tasking/src" \
  "$runtime_dir/packages/tasking/migrations" \
  "$runtime_dir/packages/telemetry/src" \
  "$runtime_dir/runtime-home" \
  "$gondolin_runtime" \
  "$voice_agent_runtime" \
  "$gondolin_assets_runtime" \
  "$skills_runtime" \
  "$runtime_dir/voice-workspace"
chmod 700 "$runtime_dir/runtime-home"
install -m 700 \
  "$repo_dir/scripts/host-broker.sh" \
  "$repo_dir/scripts/host-pi-voice.sh" \
  "$repo_dir/scripts/host-worker.sh" \
  "$runtime_dir/scripts/"
install -m 600 \
  "$repo_dir/apps/broker/pyproject.toml" \
  "$repo_dir/apps/broker/uv.lock" \
  "$runtime_dir/apps/broker/"
install -m 600 \
  "$repo_dir/apps/worker/pyproject.toml" \
  "$repo_dir/apps/worker/uv.lock" \
  "$runtime_dir/apps/worker/"
rsync -a --delete "$repo_dir/apps/broker/src/" "$runtime_dir/apps/broker/src/"
rsync -a --delete "$repo_dir/apps/worker/src/" "$runtime_dir/apps/worker/src/"
rsync -a --delete "$repo_dir/packages/tasking/src/" "$runtime_dir/packages/tasking/src/"
rsync -a --delete "$repo_dir/packages/telemetry/src/" "$runtime_dir/packages/telemetry/src/"
install -m 600 "$repo_dir"/packages/tasking/migrations/*.sql "$runtime_dir/packages/tasking/migrations/"
gondolin_deploy="$(mktemp -d "$runtime_dir/gondolin-agent.deploy.XXXXXX")"
trap 'rm -rf "$gondolin_deploy"' EXIT
# Produce a standalone dependency graph instead of copying pnpm links that
# resolve back into the repository (and therefore into protected Documents).
/opt/homebrew/bin/pnpm --dir "$repo_dir/../.." --filter @agent-workload-platform/gondolin-session build
/opt/homebrew/bin/pnpm --dir "$repo_dir/../.." --filter @agent-workload-platform/voice-pi-agent build
/opt/homebrew/bin/pnpm \
  --dir "$repo_dir/../.." \
  --config.inject-workspace-packages=true \
  --filter @agent-workload-platform/gondolin-session \
  deploy --prod --ignore-scripts "$gondolin_deploy"
rsync -a --delete "$gondolin_deploy/" "$gondolin_runtime/"
rm -rf "$gondolin_deploy"
trap - EXIT
voice_agent_deploy="$(mktemp -d "$runtime_dir/voice-pi-agent.deploy.XXXXXX")"
trap 'rm -rf "$voice_agent_deploy"' EXIT
/opt/homebrew/bin/pnpm \
  --dir "$repo_dir/../.." \
  --config.inject-workspace-packages=true \
  --filter @agent-workload-platform/voice-pi-agent \
  deploy --prod --ignore-scripts "$voice_agent_deploy"
rsync -a --delete "$voice_agent_deploy/" "$voice_agent_runtime/"
rm -rf "$voice_agent_deploy"
trap - EXIT
rsync -a --delete "$gondolin_assets_source/" "$gondolin_assets_runtime/"
rsync -a --delete --exclude='.git/' "$skills_dir/" "$skills_runtime/"

awk -F= '/^(INFERENCE_BROKER_TOKEN|BROKER_MAX_AUDIO_BYTES|BROKER_MAX_AUDIO_SECONDS|BROKER_MAX_CHAT_BYTES|BROKER_MAX_TTS_CHARS|OLLAMA_MODEL|OLLAMA_BASE_URL|MLX_STT_MODEL|STT_LANGUAGE|MLX_TTS_MODEL|MLX_TTS_VOICE|MLX_TTS_SPEED|MLX_TTS_LANGUAGE_CODE|MLX_TTS_STREAMING_INTERVAL|AGENT_GATEWAY_TOKEN|ORCHESTRATOR_ALLOWED_USERS|PI_BINARY|PI_MODEL|PI_VOICE_MODEL|PI_VOICE_THINKING|PI_VOICE_TIMEOUT_SECONDS)=/ {print}' \
  "$repo_dir/deploy/.env" > "$runtime_dir/apps/broker/broker.env"
printf 'AGENT_GATEWAY_BASE_URL="http://127.0.0.1:9444/v1"\nGONDOLIN_BROWSER_ASSETS="%s"\nPI_CODING_AGENT_DIR="%s"\nPI_VOICE_CWD="%s"\nPI_VOICE_SESSION_DIR="%s"\nPI_VOICE_SKILLS_DIR="%s"\nPI_VOICE_SERVICE_URL="http://127.0.0.1:9446"\n' \
  "$gondolin_assets_runtime" \
  "$HOME/.pi/agent" \
  "$runtime_dir/voice-workspace" \
  "$runtime_dir/pi-voice-sessions" \
  "$skills_runtime" \
  >> "$runtime_dir/apps/broker/broker.env"
chmod 600 "$runtime_dir/apps/broker/broker.env"
awk -F= '/^(DATABASE_URL|ABSURD_QUEUE|ORCHESTRATOR_APPROVAL_SECRET|ORCHESTRATOR_APPROVAL_TTL_SECONDS|ORCHESTRATOR_ALLOWED_USERS|ORCHESTRATOR_WORKSPACE_ROOTS|ORCHESTRATOR_ALLOWED_WORKSPACES|ARTIFACT_ENDPOINT_URL|ARTIFACT_BUCKET|ARTIFACT_ACCESS_KEY|ARTIFACT_SECRET_KEY|WORKER_SCRATCH_ROOT|WORKER_MAX_ARTIFACT_BYTES|PI_BINARY|PI_MODEL|PI_THINKING|PI_SESSION_DIR|WORKER_ALLOW_UNSANDBOXED|WORKER_TASK_TIMEOUT_SECONDS|WORKER_MAX_OUTPUT_BYTES|GITHUB_TOKEN|WASSETTE_BIN|WASSETTE_COMPONENT_DIR|WASSETTE_GITHUB_COMPONENT|WASSETTE_GITHUB_WRITE|MEMORY_FILE_PATH)=/ {print}' \
  "$repo_dir/deploy/.env" > "$runtime_dir/apps/worker/worker.env"
printf 'PI_GONDOLIN_EXTENSION="%s"\nGONDOLIN_BROWSER_ASSETS="%s"\nGONDOLIN_BROWSER_TOOLS=0\nGONDOLIN_MEMORY_TOOLS=0\nPI_CODING_AGENT_DIR="%s"\n' \
  "$gondolin_runtime/dist/pi-extension.js" \
  "$gondolin_assets_runtime" \
  "$HOME/.pi/agent" \
  >> "$runtime_dir/apps/worker/worker.env"
chmod 600 "$runtime_dir/apps/worker/worker.env"
/opt/homebrew/bin/uv sync --project "$runtime_dir/apps/broker" --frozen --no-dev
/opt/homebrew/bin/uv sync --project "$runtime_dir/apps/worker" --frozen --no-dev

for label in com.sathish.pipecat-agent-gateway com.sathish.pipecat-edge-machine com.sathish.pipecat-edge-tunnel; do
  launchctl bootout "$domain/$label" >/dev/null 2>&1 || true
  rm -f "$agents_dir/$label.plist"
done

for source in \
  "$repo_dir/deploy/launchd/com.sathish.pipecat-pi-voice.plist" \
  "$repo_dir/deploy/launchd/com.sathish.pipecat-broker.plist" \
  "$repo_dir/deploy/launchd/com.sathish.pipecat-worker.plist"; do
  target="$agents_dir/$(basename "$source")"
  label="$(/usr/libexec/PlistBuddy -c 'Print :Label' "$source")"
  launchctl bootout "$domain/$label" >/dev/null 2>&1 || true
  install -m 600 "$source" "$target"
  plutil -lint "$target" >/dev/null
  loaded=0
  # A broker with a timed-out Pi child can take several seconds to release its
  # loopback listener after bootout. Keep retrying the idempotent bootstrap.
  for _ in {1..15}; do
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
    && [[ "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:9446/health 2>/dev/null || true)" == 401 ]] \
    && launchctl print "$domain/com.sathish.pipecat-worker" >/dev/null 2>&1; then
    # The new app runtimes are healthy, so remove the superseded tree and its
    # copied environment files instead of retaining stale capabilities.
    rm -rf "$runtime_dir/server"
    echo "Native inference broker, Pi voice service, and Pi worker converged."
    exit 0
  fi
  sleep 2
done
echo "Native services did not converge" >&2
exit 1
