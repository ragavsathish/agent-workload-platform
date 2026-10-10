#!/usr/bin/env bash
set -euo pipefail

project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_dir"

native_swift=
native_sdk=
candidate_sdks=(
    /Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk
)
if command -v xcrun >/dev/null 2>&1; then
    candidate_sdks+=("$(xcrun --show-sdk-path 2>/dev/null || true)")
fi
candidate_swifts=(
    "$HOME/Library/Developer/Toolchains/swift-latest.xctoolchain/usr/bin/swift"
    "$(command -v swift 2>/dev/null || true)"
)
for swift_candidate in "${candidate_swifts[@]}"; do
    [[ -x "$swift_candidate" ]] || continue
    for sdk_candidate in "${candidate_sdks[@]}"; do
        [[ -d "$sdk_candidate" ]] || continue
        if SDKROOT="$sdk_candidate" "$swift_candidate" package describe >/dev/null 2>&1; then
            native_swift=$swift_candidate
            native_sdk=$sdk_candidate
            break 2
        fi
    done
done

if [[ -n "$native_swift" ]]; then
    printf 'Using native SwiftPM: %s\nSDK: %s\n' "$native_swift" "$native_sdk"
    SDKROOT="$native_sdk" "$native_swift" package --scratch-path .build-macos resolve
    SDKROOT="$native_sdk" "$native_swift" test --scratch-path .build-macos
    SDKROOT="$native_sdk" "$native_swift" build -c release --scratch-path .build-macos
    exit 0
fi

if ! docker info >/dev/null 2>&1; then
    printf '%s\n' \
        'SwiftPM is unavailable and Docker is not running.' \
        'Install/select a matching Xcode toolchain, or start Docker Desktop.' >&2
    exit 1
fi

printf '%s\n' 'Local SwiftPM is unavailable; verifying with the pinned Swift 6.2 container.'
docker run --rm \
    --user "$(id -u):$(id -g)" \
    --env HOME=/tmp \
    --volume "$project_dir:/workspace" \
    --workdir /workspace \
    swift:6.2 \
    bash -lc 'swift package resolve && swift test && swift build -c release'
