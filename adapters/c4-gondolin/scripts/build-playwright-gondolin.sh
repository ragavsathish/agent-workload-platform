#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ADAPTER_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
MONOREPO_ROOT=$(CDPATH= cd -- "$ADAPTER_DIR/../.." && pwd)
. "$SCRIPT_DIR/gondolin-common.sh"

ARCH=$(resolve_gondolin_arch "${1:-}")
PLAYWRIGHT_VERSION=1.58.2

case "$ARCH" in
  aarch64)
    OCI_ARCH=arm64
    OCI_PLATFORM=linux/arm64
    ;;
  x86_64)
    OCI_ARCH=amd64
    OCI_PLATFORM=linux/amd64
    ;;
esac

OCI_IMAGE="mermaid-excalidraw-layout:playwright-$PLAYWRIGHT_VERSION-$OCI_ARCH"
GONDOLIN_IMAGE="mermaid-layout:playwright-$PLAYWRIGHT_VERSION-$ARCH"
CONFIG="$ADAPTER_DIR/gondolin/playwright-layout.$ARCH.json"

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required to build/export the Playwright OCI image" >&2
  exit 1
}
docker info >/dev/null 2>&1 || {
  echo "Docker is installed but its daemon is not running" >&2
  exit 1
}

echo "Building OCI image $OCI_IMAGE for $OCI_PLATFORM"
docker build \
  --platform "$OCI_PLATFORM" \
  --file "$ADAPTER_DIR/Dockerfile.playwright" \
  --tag "$OCI_IMAGE" \
  "$MONOREPO_ROOT"

echo "Converting $OCI_IMAGE into Gondolin image $GONDOLIN_IMAGE"
run_gondolin build --config "$CONFIG" --tag "$GONDOLIN_IMAGE"

echo "Ready: $GONDOLIN_IMAGE"
