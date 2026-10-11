#!/usr/bin/env bash
set -euo pipefail
umask 077

runtime_dir="$HOME/Library/Application Support/PipecatEdge"
cd "$runtime_dir/gondolin-agent"
exec /opt/homebrew/bin/node dist/voice-agent-service.js
