#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
failures=0

pass() { printf 'PASS  %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; failures=$((failures + 1)); }

[[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]] && pass "Apple Silicon macOS host" || fail "Apple Silicon macOS is required"

for command in podman krunkit uv node npm ollama ssh scp curl python3; do
  command -v "$command" >/dev/null 2>&1 && pass "$command is installed" || fail "$command is missing"
done

if command -v podman >/dev/null 2>&1; then
  podman_major="$(podman --version | awk '{print $3}' | cut -d. -f1)"
  [[ "$podman_major" =~ ^[0-9]+$ && "$podman_major" -ge 5 ]] && pass "Podman version is supported" || fail "Podman 5 or newer is required"
fi

memory_bytes="$(sysctl -n hw.memsize)"
(( memory_bytes >= 8 * 1024 * 1024 * 1024 )) && pass "at least 8 GiB host RAM" || fail "at least 8 GiB host RAM is required"
(( memory_bytes >= 16 * 1024 * 1024 * 1024 )) || warn "16 GiB or more is recommended for simultaneous STT, LLM, and TTS"

free_kib="$(df -Pk "$repo_dir" | awk 'NR==2 {print $4}')"
(( free_kib >= 15 * 1024 * 1024 )) && pass "at least 15 GiB free disk" || fail "at least 15 GiB free disk is required"
(( free_kib >= 35 * 1024 * 1024 )) || warn "35 GiB free disk is recommended for images and model caches"

host_env="$repo_dir/server/.env"
if [[ -f "$host_env" ]]; then
  token="$(sed -n 's/^INFERENCE_BROKER_TOKEN=//p' "$host_env" | tail -1)"
  [[ ${#token} -ge 32 ]] && pass "inference broker capability is configured" || fail "INFERENCE_BROKER_TOKEN must be at least 32 characters"
  for key in OLLAMA_MODEL MLX_STT_MODEL MLX_TTS_MODEL; do
    grep -Eq "^${key}=.+" "$host_env" && pass "$key is configured" || fail "$key is missing from server/.env"
  done
else
  fail "server/.env is missing; run make setup"
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
