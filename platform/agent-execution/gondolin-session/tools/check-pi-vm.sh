#!/usr/bin/env bash
set -euo pipefail

if (( $# != 3 )); then
  echo "Usage: $0 <image-dir> <cache-dir> <store-dir>" >&2
  exit 2
fi

root=$(git rev-parse --show-toplevel)
image=$(cd "$1" && pwd -P)
cache=$(cd "$2" && pwd -P)
store=$(cd "$3" && pwd -P)
extension="$root/platform/agent-execution/gondolin-session/dist/pi-extension.js"
disposer="$root/platform/agent-execution/gondolin-session/dist/task-vm-cli.js"
for path in "$cache/index.json" "$store/agent/images" "$extension" "$disposer"; do
  if [[ ! -e "$path" ]]; then
    echo "Required onboarding input is missing: $path" >&2
    exit 1
  fi
done

mkdir -p "$root/artifacts/benchmarks"
run_dir=$(mktemp -d "$root/artifacts/benchmarks/onboarding-XXXXXX")
chmod 700 "$run_dir"
checkout="$run_dir/checkout"
session_dir="$run_dir/pi-session"
session_id="onboarding-$(uuidgen | tr '[:upper:]' '[:lower:]')"
token=$(uuidgen | tr '[:upper:]' '[:lower:]')
started=$(date +%s)
stages=()
session_file=
pi_pid=
failure=

finish() {
  local status=$?
  trap - EXIT
  set +e
  if [[ -n "$pi_pid" ]] && kill -0 "$pi_pid" 2>/dev/null; then
    cat 3>&- <&4 >/dev/null &
    local drain_pid=$!
    exec 3>&-
    kill -TERM "$pi_pid" 2>/dev/null
    for ((attempt=0; attempt<30; attempt++)); do
      kill -0 "$pi_pid" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$pi_pid" 2>/dev/null; then
      kill "$pi_pid" 2>/dev/null
    fi
    wait "$pi_pid" 2>/dev/null
    wait "$drain_pid" 2>/dev/null
    exec 4<&-
  fi
  if [[ -n "$session_file" && -e "$session_file.gondolin.qcow2" ]]; then
    node "$disposer" dispose "$session_file" >>"$run_dir/cleanup.log" 2>&1 || status=1
  fi
  local checkpoint_disposed=true
  if [[ -n "$session_file" && -e "$session_file.gondolin.qcow2" ]]; then
    checkpoint_disposed=false
    status=1
  fi
  rm -rf "$checkout"
  local passed=false
  (( status == 0 )) && passed=true
  local stages_json
  if (( ${#stages[@]} == 0 )); then
    stages_json='[]'
  else
    stages_json=$(printf '%s\n' "${stages[@]}" | jq -R . | jq -s .)
  fi
  jq -n --argjson passed "$passed" --argjson checkpointDisposed "$checkpoint_disposed" \
    --argjson stages "$stages_json" --arg elapsedSeconds "$(( $(date +%s) - started ))" \
    --arg image "$image" --arg cache "$cache" --arg store "$store" \
    --arg sessionFile "$session_file" --arg error "$failure" \
    '{gate:"pi-vm-check",passed:$passed,stages:$stages,
      elapsedSeconds:($elapsedSeconds|tonumber),checkpointDisposed:$checkpointDisposed,
      scope:"Pi RPC Bash and default dev Compose hook; no LLM or model-issued tool call",
      image:$image,cache:$cache,store:$store,sessionFile:$sessionFile,
      error:(if $error == "" then null else $error end)}' >"$run_dir/result.json"
  chmod 600 "$run_dir/result.json"
  echo "RESULT $run_dir/result.json"
  if [[ "$passed" == true ]]; then
    echo "PASS Pi VM check"
  else
    echo "FAIL Pi VM check" >&2
  fi
  exit "$status"
}
trap finish EXIT

fail() {
  failure=$1
  echo "$failure" >&2
  exit 1
}

start_pi() {
  rm -f "$run_dir/rpc.in" "$run_dir/rpc.out"
  mkfifo "$run_dir/rpc.in" "$run_dir/rpc.out"
  (
    cd "$checkout"
    GONDOLIN_EXECUTION_IMAGE_REF="$image" \
    GONDOLIN_DEV_IMAGE_CACHE="$cache" GONDOLIN_DEV_IMAGE_STORE="$store" \
      exec pi --mode rpc --offline --session-id "$session_id" --session-dir "$session_dir" \
        --no-extensions --extension "$extension" --no-mcp --no-skills \
        --no-prompt-templates --no-themes --no-context-files --approve \
        <"$run_dir/rpc.in" >"$run_dir/rpc.out" 2>>"$run_dir/pi.stderr.log"
  ) &
  pi_pid=$!
  exec 3>"$run_dir/rpc.in"
  exec 4<"$run_dir/rpc.out"
  request_id=0
}

stop_pi() {
  # RPC handles SIGTERM through runtime disposal and the session_shutdown hook.
  cat 3>&- <&4 >/dev/null &
  local drain_pid=$!
  exec 3>&-
  kill -TERM "$pi_pid"
  local exit_code=0
  wait "$pi_pid" || exit_code=$?
  [[ "$exit_code" == 143 || "$exit_code" == 0 ]] || fail "Pi did not shut down cleanly ($exit_code)"
  wait "$drain_pid"
  exec 4<&-
  pi_pid=
}

rpc() {
  local kind=$1 command=${2:-} id line response_id success error
  request_id=$((request_id + 1))
  id=$request_id
  jq -nc --arg id "$id" --arg type "$kind" --arg command "$command" \
    '{id:$id,type:$type} + (if $type == "bash" then {command:$command} else {} end)' >&3
  while IFS= read -r line <&4; do
    [[ $(jq -r '.type // empty' <<<"$line") == response ]] || continue
    response_id=$(jq -r '.id // empty' <<<"$line")
    [[ "$response_id" == "$id" ]] || fail "Pi RPC response ID mismatch"
    success=$(jq -r '.success' <<<"$line")
    if [[ "$success" != true ]]; then
      error=$(jq -r '.error // "unknown RPC error"' <<<"$line")
      fail "Pi RPC $kind failed: $error"
    fi
    rpc_data=$(jq -c '.data // null' <<<"$line")
    return 0
  done
  fail "Pi RPC exited during $kind"
}

pi_bash() {
  rpc bash "$1"
  local exit_code
  exit_code=$(jq -r '.exitCode // -1' <<<"$rpc_data")
  bash_output=$(jq -r '.output // ""' <<<"$rpc_data")
  [[ "$exit_code" == 0 ]] || fail "Pi Bash failed ($exit_code): $bash_output"
}

git clone --local --no-hardlinks --quiet "$root" "$checkout"
mkdir -p "$session_dir"
start_pi
rpc get_state
session_file=$(jq -r '.sessionFile // empty' <<<"$rpc_data")
[[ "$session_file" == "$session_dir/"* ]] || fail "Pi selected an unexpected session path"
# RPC Bash has no model turn, so Pi has not written its session header yet.
if [[ ! -e "$session_file" ]]; then
  jq -nc --arg id "$session_id" --arg cwd "$checkout" \
    --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{type:"session",version:3,id:$id,timestamp:$timestamp,cwd:$cwd}' >"$session_file"
fi
stages+=(pi-session-start)

pi_bash 'uname -s'
[[ "$bash_output" == Linux ]] || fail "Pi Bash did not run in Linux"
pi_bash "printf %s $token > /workspace/onboarding-marker && printf %s $token > /opt/onboarding-marker"
[[ $(cat "$checkout/onboarding-marker") == "$token" ]] || fail "Guest workspace write was not visible on host"
stages+=(pi-bash-guest-and-workspace)

stop_pi
[[ -e "$session_file.gondolin.qcow2" ]] || fail "Pi shutdown did not save a VM checkpoint"
stages+=(pi-shutdown-checkpoint)

start_pi
rpc get_state
pi_bash 'cat /workspace/onboarding-marker'
[[ "$bash_output" == "$token" ]] || fail "Workspace marker missing after Pi resume"
pi_bash 'cat /opt/onboarding-marker'
[[ "$bash_output" == "$token" ]] || fail "Guest disk marker missing after Pi resume"
stages+=(pi-resume-and-guest-disk)

stop_pi
node "$disposer" dispose "$session_file"
[[ ! -e "$session_file.gondolin.qcow2" ]] || fail "VM checkpoint remained after dispose"
stages+=(explicit-dispose)
