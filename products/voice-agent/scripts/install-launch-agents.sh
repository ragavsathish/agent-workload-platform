#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
agents_dir="$HOME/Library/LaunchAgents"
runtime_dir="$HOME/Library/Application Support/PipecatEdge"
logs_dir="$HOME/Library/Logs/PipecatEdge"
gondolin_assets_source="$repo_dir/../../artifacts/gondolin-browser/$(uname -m | sed 's/arm64/aarch64/; s/x86_64/x86_64/')"
gondolin_builder_assets_source="$repo_dir/../../artifacts/gondolin-builder/$(uname -m | sed 's/arm64/aarch64/; s/x86_64/x86_64/')"
gondolin_runtime="$runtime_dir/gondolin-agent"
voice_agent_runtime="$runtime_dir/voice-pi-agent"
gondolin_assets_runtime="$runtime_dir/gondolin-assets"
gondolin_builder_assets_runtime="$runtime_dir/gondolin-builder-assets"
gondolin_image_store="$HOME/.cache/gondolin/images"
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
wassette_bin="${WASSETTE_BIN:-$(command -v wassette || true)}"
wassette_component_dir="$runtime_dir/wassette-components"
domain="gui/$UID"
gitea_agent_token_file="$repo_dir/deploy/secrets/gitea-agent-token"
gitea_builder_token_file="$repo_dir/deploy/secrets/gitea-builder-token"
gitea_runner_token_file="$repo_dir/deploy/secrets/gitea-runner-registration-token"
gitea_dispatcher_token_file="$repo_dir/deploy/secrets/gitea-dispatcher-token"
digital_twin_writer_token_file="$repo_dir/deploy/secrets/digital-twin-writer-token"

[[ -d "$skills_dir" ]] || { echo "Missing skills directory: $skills_dir" >&2; exit 1; }
[[ -s "$gitea_agent_token_file" ]] || { echo "Missing Gitea agent token; run the Compose bootstrap first" >&2; exit 1; }
[[ -s "$gitea_builder_token_file" ]] || { echo "Missing Gitea builder token; run the Compose bootstrap first" >&2; exit 1; }
[[ -s "$gitea_runner_token_file" ]] || { echo "Missing Gitea runner registration token; run the Compose bootstrap first" >&2; exit 1; }
[[ -s "$gitea_dispatcher_token_file" ]] || { echo "Missing Gitea workflow dispatcher token; run the Compose bootstrap first" >&2; exit 1; }
[[ -s "$digital_twin_writer_token_file" ]] || { echo "Missing digital twin writer token; run the Compose bootstrap first" >&2; exit 1; }
[[ -d "$gondolin_builder_assets_source" ]] || { echo "Missing Gondolin builder bootstrap assets; run make gondolin-builder-build once" >&2; exit 1; }
[[ -x /opt/homebrew/bin/fluent-bit ]] || { echo "Missing Fluent Bit; run: brew install fluent-bit" >&2; exit 1; }
[[ -n "$wassette_bin" && -x "$wassette_bin" ]] || { echo "Missing Wassette executable; install it or set WASSETTE_BIN" >&2; exit 1; }

mkdir -p \
  "$agents_dir" \
  "$logs_dir" \
  "$runtime_dir/scripts" \
  "$runtime_dir/apps/broker/src" \
  "$runtime_dir/apps/worker/src" \
  "$runtime_dir/apps/host-observability" \
  "$runtime_dir/observability" \
  "$runtime_dir/gondolin-metrics" \
  "$runtime_dir/packages/tasking/src" \
  "$runtime_dir/packages/tasking/migrations" \
  "$runtime_dir/packages/telemetry/src" \
  "$runtime_dir/runtime-home" \
  "$gondolin_runtime" \
  "$voice_agent_runtime" \
  "$gondolin_assets_runtime" \
  "$gondolin_builder_assets_runtime" \
  "$skills_runtime" \
  "$wassette_component_dir" \
  "$runtime_dir/voice-workspace"
chmod 700 "$runtime_dir/runtime-home"
chmod 700 "$runtime_dir/gondolin-metrics"
chmod 700 "$wassette_component_dir"
chmod 700 "$logs_dir"
touch "$logs_dir/broker.log" "$logs_dir/pi-voice.log" "$logs_dir/worker.log" "$logs_dir/image-builder.log" "$logs_dir/host-observability.log" "$logs_dir/digital-twin-listener.log"
chmod 600 "$logs_dir"/*.log
install -m 700 \
  "$repo_dir/deploy/launchd/run-broker.sh" \
  "$repo_dir/deploy/launchd/run-host-observability.sh" \
  "$repo_dir/deploy/launchd/run-digital-twin-listener.sh" \
  "$repo_dir/deploy/launchd/run-pi-agent.sh" \
  "$repo_dir/deploy/launchd/run-worker.sh" \
  "$repo_dir/deploy/launchd/run-image-builder.sh" \
  "$runtime_dir/scripts/"
install -m 600 \
  "$repo_dir/apps/host-observability/gondolin-exporter.mjs" \
  "$runtime_dir/apps/host-observability/"
install -m 600 \
  "$repo_dir/deploy/observability/fluent-bit-host.yaml" \
  "$runtime_dir/observability/"
rm -f \
  "$runtime_dir/scripts/host-broker.sh" \
  "$runtime_dir/scripts/host-pi-voice.sh" \
  "$runtime_dir/scripts/host-worker.sh"
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
rsync -a --delete --exclude='image-cache/' "$gondolin_deploy/" "$gondolin_runtime/"
rm -rf "$gondolin_deploy"
trap - EXIT
voice_agent_deploy="$(mktemp -d "$runtime_dir/voice-pi-agent.deploy.XXXXXX")"
trap 'rm -rf "$voice_agent_deploy"' EXIT
/opt/homebrew/bin/pnpm \
  --dir "$repo_dir/../.." \
  --config.inject-workspace-packages=true \
  --filter @agent-workload-platform/voice-pi-agent \
  deploy --prod --ignore-scripts "$voice_agent_deploy"
if [[ -e "$voice_agent_deploy/digital-twin/eval" ]] || [[ -e "$voice_agent_deploy/node_modules/promptfoo" ]]; then
  printf 'Refusing to install: the voice agent production artifact contains evaluation-only code or dependencies.\n' >&2
  exit 1
fi
rsync -a --delete "$voice_agent_deploy/" "$voice_agent_runtime/"
rm -rf "$voice_agent_deploy"
trap - EXIT
# Keep the digital-twin runner self-contained in the installed runtime. pnpm's
# workspace link can otherwise point back into the source checkout, and older
# partial installs may not contain the package at all.
mkdir -p "$voice_agent_runtime/node_modules/@agent-workload-platform"
rm -rf "$voice_agent_runtime/node_modules/@agent-workload-platform/gondolin-session"
ln -s ../../../gondolin-agent \
  "$voice_agent_runtime/node_modules/@agent-workload-platform/gondolin-session"
rsync -a --delete "$gondolin_assets_source/" "$gondolin_assets_runtime/"
rsync -a --delete "$gondolin_builder_assets_source/" "$gondolin_builder_assets_runtime/"
rsync -a --delete --exclude='.git/' "$skills_dir/" "$skills_runtime/"

awk -F= '/^(INFERENCE_BROKER_TOKEN|BROKER_MAX_AUDIO_BYTES|BROKER_MAX_AUDIO_SECONDS|BROKER_MAX_CHAT_BYTES|BROKER_MAX_TTS_CHARS|OLLAMA_MODEL|OLLAMA_BASE_URL|MLX_STT_MODEL|MLX_TTS_MODEL|MLX_TTS_VOICE|MLX_TTS_SPEED|MLX_TTS_LANGUAGE_CODE|MLX_TTS_STREAMING_INTERVAL|AGENT_GATEWAY_TOKEN|ORCHESTRATOR_ALLOWED_USERS|ARTIFACT_ENDPOINT_URL|ARTIFACT_BUCKET|ARTIFACT_ACCESS_KEY|ARTIFACT_SECRET_KEY|GITEA_ENDPOINT_URL|GITEA_OWNER|PI_BINARY|PI_MODEL|PI_VOICE_MODEL|PI_VOICE_THINKING|PI_VOICE_TIMEOUT_SECONDS)=/ {print}' \
  "$repo_dir/deploy/.env" > "$runtime_dir/apps/broker/broker.env"
printf 'AGENT_GATEWAY_BASE_URL="http://127.0.0.1:9444/v1"\nGONDOLIN_BROWSER_ASSETS="%s"\nPI_CODING_AGENT_DIR="%s"\nPI_VOICE_CWD="%s"\nPI_VOICE_SESSION_DIR="%s"\nPI_VOICE_SKILLS_DIR="%s"\nPI_VOICE_SERVICE_URL="http://127.0.0.1:9446"\nWASSETTE_BIN="%s"\nWASSETTE_COMPONENT_DIR="%s"\n' \
  "$gondolin_assets_runtime" \
  "$HOME/.pi/agent" \
  "$runtime_dir/voice-workspace" \
  "$runtime_dir/pi-voice-sessions" \
  "$skills_runtime" \
  "$wassette_bin" \
  "$wassette_component_dir" \
  >> "$runtime_dir/apps/broker/broker.env"
printf 'GONDOLIN_METRICS_DIR="%s"\n' "$runtime_dir/gondolin-metrics" >> "$runtime_dir/apps/broker/broker.env"
printf 'TASK_GATEWAY_BASE_URL="http://127.0.0.1:9444/v1"\nTASK_GATEWAY_TOKEN="%s"\nTASK_IDENTITY="%s"\n' \
  "$(sed -n 's/^AGENT_GATEWAY_TOKEN=//p' "$repo_dir/deploy/.env" | tail -1)" \
  "$(sed -n 's/^ORCHESTRATOR_ALLOWED_USERS=//p' "$repo_dir/deploy/.env" | tail -1)" \
  > "$runtime_dir/wassette-tasking.env"
chmod 600 "$runtime_dir/wassette-tasking.env"
printf 'WASSETTE_ENV_FILE="%s"\n' "$runtime_dir/wassette-tasking.env" >> "$runtime_dir/apps/broker/broker.env"
printf 'OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:4318"\nOTEL_LOGS_EXPORTER="none"\nOTEL_METRIC_EXPORT_INTERVAL="5000"\n' \
  >> "$runtime_dir/apps/broker/broker.env"
printf 'GITEA_TOKEN="%s"\n' "$(<"$gitea_agent_token_file")" >> "$runtime_dir/apps/broker/broker.env"
chmod 600 "$runtime_dir/apps/broker/broker.env"
awk -F= '/^(DATABASE_URL|ABSURD_QUEUE|IMAGE_BUILD_TIMEOUT_SECONDS|NODE_BINARY|ORCHESTRATOR_APPROVAL_SECRET|ORCHESTRATOR_APPROVAL_TTL_SECONDS|ORCHESTRATOR_ALLOWED_USERS|ORCHESTRATOR_WORKSPACE_ROOTS|ORCHESTRATOR_ALLOWED_WORKSPACES|ARTIFACT_ENDPOINT_URL|ARTIFACT_BUCKET|ARTIFACT_ACCESS_KEY|ARTIFACT_SECRET_KEY|GITEA_ENDPOINT_URL|GITEA_OWNER|GITEA_IMAGE_WORKFLOW|GITEA_WORKFLOW_REF|WORKER_SCRATCH_ROOT|WORKER_MAX_ARTIFACT_BYTES|PI_BINARY|PI_MODEL|PI_THINKING|PI_SESSION_DIR|WORKER_ALLOW_UNSANDBOXED|WORKER_TASK_TIMEOUT_SECONDS|WORKER_MAX_OUTPUT_BYTES)=/ {print}' \
  "$repo_dir/deploy/.env" > "$runtime_dir/apps/worker/worker.env"
printf 'PI_GONDOLIN_EXTENSION="%s"\nPI_TASK_SKILLS_DIR="%s"\nGONDOLIN_BROWSER_ASSETS="%s"\nGONDOLIN_IMAGE_STORE="%s"\nGONDOLIN_BROWSER_TOOLS=0\nGONDOLIN_PUBLIC_INTERNET=1\nPI_CODING_AGENT_DIR="%s"\n' \
  "$gondolin_runtime/dist/pi-extension.js" \
  "$skills_runtime" \
  "$gondolin_assets_runtime" \
  "$gondolin_image_store" \
  "$HOME/.pi/agent" \
  >> "$runtime_dir/apps/worker/worker.env"
printf 'GONDOLIN_METRICS_DIR="%s"\n' "$runtime_dir/gondolin-metrics" >> "$runtime_dir/apps/worker/worker.env"
printf 'OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:4318"\nOTEL_LOGS_EXPORTER="none"\nOTEL_METRIC_EXPORT_INTERVAL="5000"\n' \
  >> "$runtime_dir/apps/worker/worker.env"
printf 'GITEA_PACKAGE_OWNER="image-builder"\nGITEA_BUILDER_TOKEN="%s"\nGITEA_ACTIONS_TOKEN="%s"\nIMAGE_INSTALLER_CLI="%s"\n' \
  "$(<"$gitea_builder_token_file")" \
  "$(<"$gitea_dispatcher_token_file")" \
  "$gondolin_runtime/dist/image-builder/installer.js" \
  >> "$runtime_dir/apps/worker/worker.env"
printf 'DIGITAL_TWIN_RUNNER="%s"\nDIGITAL_TWIN_IMAGE_REF="digital-twin-ingest:v1"\nDIGITAL_TWIN_MODEL_BASE_URL="%s"\nDIGITAL_TWIN_MODEL="%s"\nDIGITAL_TWIN_WRITER_BASE_URL="http://127.0.0.1:9444"\nDIGITAL_TWIN_WRITER_TOKEN="%s"\nDIGITAL_TWIN_TIMEOUT_SECONDS="120"\n' \
  "$voice_agent_runtime/dist/digital-twin/runtime/task-runner.js" \
  "$(sed -n 's/^OLLAMA_BASE_URL=//p' "$repo_dir/deploy/.env" | tail -1)" \
  "$(sed -n 's/^OLLAMA_MODEL=//p' "$repo_dir/deploy/.env" | tail -1)" \
  "$(<"$digital_twin_writer_token_file")" \
  >> "$runtime_dir/apps/worker/worker.env"
chmod 600 "$runtime_dir/apps/worker/worker.env"
printf 'GITEA_ENDPOINT_URL="http://127.0.0.1:3001"\nGITEA_RUNNER_REGISTRATION_TOKEN="%s"\nGONDOLIN_BUILDER_ASSETS="%s"\nGONDOLIN_BUILDER_CHECKPOINT="%s"\nGONDOLIN_RUNNER_DIR="%s"\n' \
  "$(<"$gitea_runner_token_file")" \
  "$gondolin_builder_assets_runtime" \
  "$runtime_dir/gondolin-builder-checkpoint.qcow2" \
  "$gondolin_runtime" \
  > "$gondolin_runtime/image-builder.env"
printf 'GONDOLIN_BUILDER_DISK="128G"\n' \
  >> "$gondolin_runtime/image-builder.env"
printf 'OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:4318"\nOTEL_LOGS_EXPORTER="none"\nOTEL_METRIC_EXPORT_INTERVAL="5000"\n' \
  >> "$gondolin_runtime/image-builder.env"
chmod 600 "$gondolin_runtime/image-builder.env"
/opt/homebrew/bin/uv sync --project "$runtime_dir/apps/broker" --frozen --no-dev
/opt/homebrew/bin/uv sync --project "$runtime_dir/apps/worker" --frozen --no-dev

for label in com.sathish.pipecat-agent-gateway com.sathish.pipecat-edge-machine com.sathish.pipecat-edge-tunnel; do
  launchctl bootout "$domain/$label" >/dev/null 2>&1 || true
  rm -f "$agents_dir/$label.plist"
done

for source in \
  "$repo_dir/deploy/launchd/com.sathish.pipecat-host-observability.plist" \
  "$repo_dir/deploy/launchd/com.sathish.pipecat-digital-twin-listener.plist" \
  "$repo_dir/deploy/launchd/com.sathish.pipecat-pi-voice.plist" \
  "$repo_dir/deploy/launchd/com.sathish.pipecat-broker.plist" \
  "$repo_dir/deploy/launchd/com.sathish.pipecat-image-builder.plist" \
  "$repo_dir/deploy/launchd/com.sathish.pipecat-worker.plist"; do
  target="$agents_dir/$(basename "$source")"
  label="$(/usr/libexec/PlistBuddy -c 'Print :Label' "$source")"
  if [[ "$label" == "com.sathish.pipecat-image-builder" ]] \
    && launchctl print "$domain/$label" >/dev/null 2>&1; then
    install -m 600 "$source" "$target"
    plutil -lint "$target" >/dev/null
    echo "Preserved the running shared builder VM; updated configuration applies at its next restart."
    continue
  fi
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
    && curl -fsS http://127.0.0.1:2022/metrics | grep -q 'node_uname_info{system="macos-host"' \
    && curl -fsS http://127.0.0.1:9465/metrics | grep -q '^gondolin_vm_count ' \
    && launchctl print "$domain/com.sathish.pipecat-worker" >/dev/null 2>&1; then
    launchctl print "$domain/com.sathish.pipecat-digital-twin-listener" >/dev/null 2>&1 || continue
    launchctl print "$domain/com.sathish.pipecat-image-builder" >/dev/null 2>&1 || continue
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
