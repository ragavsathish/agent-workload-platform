#!/usr/bin/env bash
set -euo pipefail

model_root=${1:-"/Users/sathish.narayanan/Library/Application Support/PipecatSwiftBroker/Models"}
environment_file="$model_root/model.env"
if [[ ! -f "$environment_file" || -L "$environment_file" ]]; then
    echo "missing trusted model environment: $environment_file" >&2
    exit 1
fi

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$environment_file"

sdk=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk
if [[ ! -d "$sdk" ]]; then
    sdk=$(xcrun --show-sdk-path)
fi
validator=$(mktemp /tmp/pipecat-coreml-validator.XXXXXX)
cleanup() { rm -f -- "$validator"; }
trap cleanup EXIT

swiftc -parse-as-library -target arm64-apple-macosx15.0 -sdk "$sdk" \
    "$script_dir/validate_coreml_models.swift" -o "$validator"
"$validator" \
    "$SWIFT_VAD_MODEL_DIRECTORY" \
    "$SWIFT_DIARIZER_SEGMENTATION_MODEL" \
    "$SWIFT_DIARIZER_EMBEDDING_MODEL" \
    "$SWIFT_WHISPER_MODEL_DIRECTORY/MelSpectrogram.mlmodelc" \
    "$SWIFT_WHISPER_MODEL_DIRECTORY/AudioEncoder.mlmodelc" \
    "$SWIFT_WHISPER_MODEL_DIRECTORY/TextDecoder.mlmodelc" \
    "$SWIFT_KOKORO_MODEL_DIRECTORY/kokoro_frontend.mlmodelc" \
    "$SWIFT_KOKORO_MODEL_DIRECTORY/kokoro_backend.mlmodelc"
