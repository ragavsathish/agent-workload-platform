#!/usr/bin/env bash
set -euo pipefail
umask 077

runtime_dir="$HOME/Library/Application Support/PipecatEdge"
exec /opt/homebrew/bin/node "$runtime_dir/apps/host-observability/gondolin-exporter.mjs"
