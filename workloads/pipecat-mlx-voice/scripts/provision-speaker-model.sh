#!/usr/bin/env bash
set -euo pipefail

filename='wespeaker_en_voxceleb_CAM++.onnx'
expected_sha256='c46fad10b5f81e1aa4a60c162714208577093655076c5450f8c469e522ec54ef'
url='https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_CAM%2B%2B.onnx'
target_dir="$HOME/Library/Application Support/PipecatEdge/models/speaker"
target="$target_dir/$filename"

mkdir -p "$target_dir"
chmod 700 "$target_dir"
if [[ -L "$target_dir" || -L "$target" ]]; then
  echo 'speaker model path must not be a symbolic link' >&2
  exit 1
fi
if [[ -f "$target" ]] && [[ "$(shasum -a 256 "$target" | awk '{print $1}')" == "$expected_sha256" ]]; then
  echo "Pinned speaker model already exists at $target"
  exit 0
fi

temporary="$(mktemp "$target_dir/.speaker-model.XXXXXX")"
trap 'rm -f "$temporary"' EXIT
curl --fail --location --silent --show-error "$url" --output "$temporary"
echo "$expected_sha256  $temporary" | shasum -a 256 --check --status
chmod 600 "$temporary"
mv "$temporary" "$target"
trap - EXIT
echo "Pinned speaker model installed at $target"
