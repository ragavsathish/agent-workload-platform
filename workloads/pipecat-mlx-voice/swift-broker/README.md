# Pipecat Swift inference broker

This is a native macOS replacement project for the Python/MLX inference broker. It is deliberately
parallel to the active service: nothing in this directory changes the current launchd unit, port,
or Pipecat configuration.

The implementation now supplies the hardened service boundary, native model adapters, and the
existing broker contracts:

- Swift 6 strict concurrency and actor-isolated inference admission;
- Hummingbird 2 pinned to an exact release and bound to loopback only;
- HMAC-based bearer verification before route handling;
- a strict, bounded mono PCM16/16 kHz RIFF/WAV parser;
- fail-closed VAD → speaker match → STT orchestration;
- multi-utterance, normalized speaker enrollment;
- a Data Protection Keychain speaker-profile store;
- FluidAudio VAD and CAM++ owner-speaker gating before WhisperKit STT;
- Kokoro Core ML synthesis as signed little-endian 24 kHz PCM16; and
- fixed-destination Ollama and Pi HTTP adapters with model/tool allowlists.

Startup fails closed unless every model path is local, absolute, beneath one model root, present,
and free of symbolic links. WhisperKit downloads are disabled. The CAM++ artifact is checked against
its configured deterministic SHA-256 before it is loaded. Do not point Pipecat at this process until
the model artifact lock and compatibility measurements have been completed.

## Requirements

- Apple Silicon Mac running macOS 15 or newer;
- the pinned Swift 6.3.3 toolchain (full Xcode or the official user-local toolchain); and
- model artifacts provisioned outside the request path.

The check script selects the user-local Swift 6.3.3 toolchain and compatible macOS 26.5 SDK when
present. It otherwise tries the selected system toolchain, then runs the cross-platform targets in
the pinned Swift 6.2 container. The `.swift-version` file pins Swiftly-compatible environments.
To select a full Xcode installation instead:

```sh
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
xcodebuild -version
swift --version
```

## Build and test

```sh
make -C .. swift-broker-check
```

`Package.resolved` is committed to pin the full transitive dependency graph. Run `swift format lint
--recursive Sources Tests` with the project configuration when the selected toolchain provides
`swift-format`.

At runtime, provide `INFERENCE_BROKER_TOKEN` (at least 32 UTF-8 bytes), `OLLAMA_MODEL`, exactly one
`ORCHESTRATOR_ALLOWED_USERS` identity, and `AGENT_GATEWAY_TOKEN` (at least 32 bytes). The process
rejects non-loopback bind addresses and non-loopback Ollama/Pi upstream URLs.

Native model startup additionally requires:

```text
SWIFT_MODEL_ROOT
SWIFT_WHISPER_MODEL_DIRECTORY
SWIFT_WHISPER_MODEL_HASH
SWIFT_VAD_MODEL_DIRECTORY
SWIFT_VAD_MODEL_HASH
SWIFT_DIARIZER_SEGMENTATION_MODEL
SWIFT_DIARIZER_SEGMENTATION_HASH
SWIFT_DIARIZER_EMBEDDING_MODEL
SWIFT_KOKORO_MODEL_DIRECTORY
SWIFT_KOKORO_MODEL_HASH
SWIFT_SPEAKER_MODEL_HASH
```

`SWIFT_SPEAKER_MODEL_HASH` uses the algorithm documented in `MODEL_PROVENANCE.md`. Optional knobs
are `SWIFT_SPEAKER_MODEL_ID`, `SWIFT_TTS_VOICE`, `STT_LANGUAGE`, and
`SWIFT_MINIMUM_SPEECH_SECONDS`.

Provision every artifact at the exact revision recorded in `Models.lock.json` into a new absolute
directory. The script verifies the Kokoro release digest, fetches only the required Git LFS objects,
rejects symbolic links, and writes the calculated runtime hashes to `model.env`:

```sh
../scripts/provision-swift-models.sh \
  "$HOME/Library/Application Support/PipecatSwiftBroker/Models"
```

`SWIFT_VAD_MODEL_DIRECTORY` points to the exact compiled `.mlmodelc` bundle despite its historical
name. The broker loads that bundle directly and forces FluidAudio offline before model construction.

Enroll locally from at least three clean, mono PCM16/16 kHz WAV utterances. This is a separate local
administrative operation and is not exposed to Pipecat:

```sh
SWIFT_SPEAKER_THRESHOLD=0.78 swift run -c release pipecat-swift-broker enroll \
  owner-1.wav owner-2.wav owner-3.wav
```

The command stores only the normalized averaged embedding in the Data Protection Keychain. It does
not retain the recordings.

## Validation status

The native package builds in release mode and all 19 tests pass on this host. The live service on a
separate loopback port matches the Python broker for authenticated/anonymous health, fixed-model
JSON and streamed chat, PCM TTS, Pi JSON/SSE, and Pi tool rejection. Streamed Ollama responses are
forwarded incrementally instead of buffered. The pinned Core ML artifacts are provisioned and pass
load and zero-input prediction smoke tests. Owner-gated STT remains fail-closed until enrollment.

With no owner recording, benchmark LLM and TTS only. Once enrolled, pass the same owner WAV to both
commands so STT measures identical input:

```sh
make -C .. benchmark-swift
make -C .. compare-broker-interfaces
make -C .. benchmark-swift STT_WAV=/absolute/path/to/owner.wav
make -C .. compare-broker-interfaces STT_WAV=/absolute/path/to/owner.wav
```

Downloads happen during provisioning, never at startup or in a request.

See [the research report](../docs/swift-broker-research.md) and [the security policy](SECURITY.md).
