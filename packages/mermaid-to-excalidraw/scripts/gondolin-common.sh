#!/bin/sh

run_gondolin() {
  if [ -n "${GONDOLIN_BIN:-}" ]; then
    "$GONDOLIN_BIN" "$@"
  elif command -v gondolin >/dev/null 2>&1; then
    gondolin "$@"
  else
    npx --yes @earendil-works/gondolin@0.12.0 "$@"
  fi
}

resolve_gondolin_arch() {
  requested_arch=${1:-}
  if [ -n "$requested_arch" ]; then
    case "$requested_arch" in
      arm64|aarch64) printf '%s\n' aarch64 ;;
      amd64|x86_64) printf '%s\n' x86_64 ;;
      *)
        echo "Unsupported architecture: $requested_arch" >&2
        return 2
        ;;
    esac
    return
  fi

  case "$(uname -m)" in
    arm64|aarch64) printf '%s\n' aarch64 ;;
    amd64|x86_64) printf '%s\n' x86_64 ;;
    *)
      echo "Unsupported host architecture: $(uname -m)" >&2
      return 2
      ;;
  esac
}
