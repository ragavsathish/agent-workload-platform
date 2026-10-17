#!/usr/bin/env bash
set -euo pipefail

runtime_dir="$HOME/Library/Application Support/PipecatEdge"
export HOME="$runtime_dir/runtime-home"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p "$HOME"
chmod 700 "$HOME"
set -a
# shellcheck disable=SC1091
source "$runtime_dir/gondolin-agent/image-builder.env"
set +a
cd "$runtime_dir/gondolin-agent"
exec /opt/homebrew/bin/node dist/image-builder/manager.js
