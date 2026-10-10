#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || "$1" != /* ]]; then
    echo "usage: $0 /absolute/new/model/root" >&2
    exit 2
fi

target=$1
if [[ -e "$target" || -L "$target" ]]; then
    echo "target must not already exist: $target" >&2
    exit 2
fi
target_parent=$(dirname "$target")
mkdir -p "$target_parent"
if [[ -L "$target_parent" ]]; then
    echo "target parent must not be a symbolic link" >&2
    exit 2
fi

for command_name in curl git git-lfs python3 shasum tar; do
    command -v "$command_name" >/dev/null || {
        echo "missing required command: $command_name" >&2
        exit 1
    }
done

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
staging=$(mktemp -d "$target_parent/.pipecat-swift-models.XXXXXX")
cleanup() {
    if [[ -n "${staging:-}" && -d "$staging" ]]; then
        rm -rf -- "$staging"
    fi
}
trap cleanup EXIT

clone_model() {
    local repository=$1 revision=$2 destination=$3 include=$4
    GIT_LFS_SKIP_SMUDGE=1 git clone --quiet --no-checkout \
        "https://huggingface.co/$repository" "$destination"
    git -C "$destination" lfs install --local >/dev/null
    GIT_LFS_SKIP_SMUDGE=1 git -C "$destination" checkout --quiet "$revision"
    git -C "$destination" lfs pull --include="$include" --exclude=""
}

mkdir -p "$staging/whisper" "$staging/vad" "$staging/diarizer" "$staging/kokoro"

clone_model \
    FluidInference/silero-vad-coreml \
    b419383c55c110e2c9271fa6ee0ea83d03c70d96 \
    "$staging/vad-repository" \
    'silero-vad-unified-256ms-v6.2.1.mlmodelc/**'
mv "$staging/vad-repository/silero-vad-unified-256ms-v6.2.1.mlmodelc" "$staging/vad/"

clone_model \
    FluidInference/speaker-diarization-coreml \
    df2625ac79a7ac6b65ad868fee6d80f320da4232 \
    "$staging/diarizer-repository" \
    'pyannote_segmentation.mlmodelc/**,wespeaker_v2.mlmodelc/**'
mv "$staging/diarizer-repository/pyannote_segmentation.mlmodelc" "$staging/diarizer/"
mv "$staging/diarizer-repository/wespeaker_v2.mlmodelc" "$staging/diarizer/"

clone_model \
    argmaxinc/whisperkit-coreml \
    0f63a7800b00dd0226abd051b906c246e1907482 \
    "$staging/whisper-repository" \
    'openai_whisper-large-v3-v20240930_626MB/**'
mv "$staging/whisper-repository/openai_whisper-large-v3-v20240930_626MB" "$staging/whisper/"

kokoro_archive="$staging/kokoro-models.tar.gz"
curl --fail --location --silent --show-error \
    https://github.com/Jud/kokoro-coreml/releases/download/models-2026-03-23/kokoro-models.tar.gz \
    --output "$kokoro_archive"
echo "0d24bbf80526456bd8640f9f484cd1c333aee8a936e618ac44e619eafb79aec9  $kokoro_archive" \
    | shasum -a 256 --check --status
while IFS= read -r entry; do
    case "$entry" in
        /*|../*|*/../*|*/..) echo "unsafe archive path: $entry" >&2; exit 1 ;;
    esac
done < <(tar -tzf "$kokoro_archive")
tar -xzf "$kokoro_archive" -C "$staging/kokoro"

if find "$staging/whisper" "$staging/vad" "$staging/diarizer" "$staging/kokoro" \
    -type l -print -quit | grep -q .; then
    echo "downloaded model artifacts contain a symbolic link" >&2
    exit 1
fi
if grep -RIl --include='*' '^version https://git-lfs.github.com/spec/v1$' \
    "$staging/whisper" "$staging/vad" "$staging/diarizer" "$staging/kokoro" \
    | grep -q .; then
    echo "one or more model artifacts are unresolved Git LFS pointers" >&2
    exit 1
fi

whisper="$staging/whisper/openai_whisper-large-v3-v20240930_626MB"
vad="$staging/vad/silero-vad-unified-256ms-v6.2.1.mlmodelc"
segmentation="$staging/diarizer/pyannote_segmentation.mlmodelc"
embedding="$staging/diarizer/wespeaker_v2.mlmodelc"

kokoro_candidates=("$staging/kokoro"/*)
if [[ ${#kokoro_candidates[@]} -eq 1 && -d "${kokoro_candidates[0]}" ]]; then
    kokoro="${kokoro_candidates[0]}"
else
    kokoro="$staging/kokoro"
fi
kokoro_relative=${kokoro#"$staging/"}

whisper_hash=$(python3 "$script_dir/hash_model_artifact.py" "$whisper")
vad_hash=$(python3 "$script_dir/hash_model_artifact.py" "$vad")
segmentation_hash=$(python3 "$script_dir/hash_model_artifact.py" "$segmentation")
embedding_hash=$(python3 "$script_dir/hash_model_artifact.py" "$embedding")
kokoro_hash=$(python3 "$script_dir/hash_model_artifact.py" "$kokoro")

rm -rf -- "$staging/vad-repository" "$staging/diarizer-repository" \
    "$staging/whisper-repository" "$kokoro_archive"
mv "$staging" "$target"
staging=""

environment_file="$target/model.env"
umask 077
write_environment_value() {
    local key=$1 value=$2
    printf '%s=' "$key"
    printf '%q\n' "$value"
}
{
    write_environment_value SWIFT_MODEL_ROOT "$target"
    write_environment_value SWIFT_WHISPER_MODEL_DIRECTORY "$target/whisper/openai_whisper-large-v3-v20240930_626MB"
    write_environment_value SWIFT_WHISPER_MODEL_HASH "$whisper_hash"
    write_environment_value SWIFT_VAD_MODEL_DIRECTORY "$target/vad/silero-vad-unified-256ms-v6.2.1.mlmodelc"
    write_environment_value SWIFT_VAD_MODEL_HASH "$vad_hash"
    write_environment_value SWIFT_DIARIZER_SEGMENTATION_MODEL "$target/diarizer/pyannote_segmentation.mlmodelc"
    write_environment_value SWIFT_DIARIZER_SEGMENTATION_HASH "$segmentation_hash"
    write_environment_value SWIFT_DIARIZER_EMBEDDING_MODEL "$target/diarizer/wespeaker_v2.mlmodelc"
    write_environment_value SWIFT_SPEAKER_MODEL_HASH "$embedding_hash"
    write_environment_value SWIFT_KOKORO_MODEL_DIRECTORY "$target/$kokoro_relative"
    write_environment_value SWIFT_KOKORO_MODEL_HASH "$kokoro_hash"
} >"$environment_file"

echo "Pinned model artifacts provisioned at $target"
echo "Runtime environment written to $environment_file"
