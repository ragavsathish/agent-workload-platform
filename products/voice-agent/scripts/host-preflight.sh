#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
failures=0

pass() { printf 'PASS  %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; failures=$((failures + 1)); }

[[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]] && pass "Apple Silicon macOS host" || fail "Apple Silicon macOS is required"

for command in docker uv node npm ollama curl python3 wassette; do
  command -v "$command" >/dev/null 2>&1 && pass "$command is installed" || fail "$command is missing"
done
[[ -x /opt/homebrew/opt/libpq/bin/psql ]] && pass "Homebrew libpq client is installed" || fail "libpq is required: brew install libpq"

docker info >/dev/null 2>&1 && pass "Docker Desktop is running" || fail "Docker Desktop must be running"
docker compose version >/dev/null 2>&1 && pass "Docker Compose is installed" || fail "Docker Compose is required"

memory_bytes="$(sysctl -n hw.memsize)"
(( memory_bytes >= 8 * 1024 * 1024 * 1024 )) && pass "at least 8 GiB host RAM" || fail "at least 8 GiB host RAM is required"
(( memory_bytes >= 16 * 1024 * 1024 * 1024 )) || warn "16 GiB or more is recommended for simultaneous STT, LLM, and TTS"

free_kib="$(df -Pk "$repo_dir" | awk 'NR==2 {print $4}')"
(( free_kib >= 15 * 1024 * 1024 )) && pass "at least 15 GiB free disk" || fail "at least 15 GiB free disk is required"
(( free_kib >= 35 * 1024 * 1024 )) || warn "35 GiB free disk is recommended for images and model caches"

host_env="$repo_dir/deploy/.env"
if [[ -f "$host_env" ]]; then
  token="$(sed -n 's/^INFERENCE_BROKER_TOKEN=//p' "$host_env" | tail -1)"
  [[ ${#token} -ge 32 && "$token" != replace-with-* ]] && pass "inference broker capability is configured" || fail "INFERENCE_BROKER_TOKEN must be a generated value of at least 32 characters"
  agent_token="$(sed -n 's/^AGENT_GATEWAY_TOKEN=//p' "$host_env" | tail -1)"
  [[ ${#agent_token} -ge 32 && "$agent_token" != replace-with-* ]] && pass "agent gateway capability is configured" || fail "AGENT_GATEWAY_TOKEN must be a generated value of at least 32 characters"
  postgres_password="$(sed -n 's/^POSTGRES_PASSWORD=//p' "$host_env" | tail -1)"
  [[ ${#postgres_password} -ge 16 && "$postgres_password" != replace-with-* ]] && pass "Postgres password is configured" || fail "POSTGRES_PASSWORD must be a generated value of at least 16 characters"
  for key in OLLAMA_MODEL MLX_STT_MODEL MLX_TTS_MODEL VOICE_DEFAULT_WORKSPACE ORCHESTRATOR_ALLOWED_WORKSPACES ARTIFACT_ENDPOINT_URL ARTIFACT_BUCKET; do
    grep -Eq "^${key}=.+" "$host_env" && pass "$key is configured" || fail "$key is missing from deploy/.env"
  done
  default_workspace="$(sed -n 's/^VOICE_DEFAULT_WORKSPACE=//p' "$host_env" | tail -1)"
  allowed_workspaces="$(sed -n 's/^ORCHESTRATOR_ALLOWED_WORKSPACES=//p' "$host_env" | tail -1)"
  [[ ",$allowed_workspaces," == *",$default_workspace,"* ]] && pass "default logical workspace is allowlisted" || fail "VOICE_DEFAULT_WORKSPACE must be in ORCHESTRATOR_ALLOWED_WORKSPACES"
else
  fail "deploy/.env is missing; run make setup"
fi

if curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  pass "Ollama is listening on host loopback"
else
  warn "Ollama is not responding on 127.0.0.1:11434"
fi

if command -v ollama >/dev/null 2>&1 && [[ -f "$host_env" ]]; then
  model="$(sed -n 's/^OLLAMA_MODEL=//p' "$host_env" | tail -1)"
  if [[ -n "$model" ]] && ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -Fxq "$model"; then
    pass "Ollama model $model is installed"
  else
    warn "Ollama model ${model:-<unset>} is not installed; run make pull-model"
  fi
fi

if (( failures > 0 )); then
  echo "$failures required host check(s) failed." >&2
  exit 1
fi
echo "Host preflight passed."
