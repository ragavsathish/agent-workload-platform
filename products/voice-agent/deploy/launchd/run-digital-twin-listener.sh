#!/usr/bin/env bash
set -euo pipefail
umask 077

runtime_dir="$HOME/Library/Application Support/PipecatEdge"
export HOME="$runtime_dir/runtime-home"
set -a
# shellcheck disable=SC1091
source "$runtime_dir/apps/digital-twin/listener.env"
set +a
exec /opt/homebrew/bin/node \
  "$runtime_dir/voice-pi-agent/dist/digital-twin/runtime/session-listener.js"
