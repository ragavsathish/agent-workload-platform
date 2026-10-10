# Native Swift inference broker research

Date: 2026-10-10

## Decision

A complete native rewrite of `server/inference_broker.py` is feasible and can preserve the
Pipecat-facing HTTP contract. The recommended baseline is a Swift 6.2 Swift Package Manager
executable targeting macOS 15 or newer, using:

- [Hummingbird 2](https://github.com/hummingbird-project/hummingbird) for the loopback HTTP server;
- [FluidAudio](https://github.com/FluidInference/FluidAudio) for VAD and CAM++ speaker embeddings;
- [WhisperKit in Argmax OSS](https://github.com/argmaxinc/argmax-oss-swift) for Whisper-family STT;
- [kokoro-coreml](https://github.com/Jud/kokoro-coreml) for Kokoro TTS;
- `URLSession` or Hummingbird's AsyncHTTPClient dependency for the fixed Ollama and Pi upstreams;
- Security.framework/Keychain for the bearer token and enrolled speaker profile.

The deployment target is macOS 15 because kokoro-coreml declares macOS 15 and Swift tools 6.2.
FluidAudio itself supports macOS 14 and Swift 6; WhisperKit supports older macOS releases, but the
combined executable must use the highest requirement. The current host (Apple Silicon on macOS 26)
meets that requirement.

This should be implemented as a parallel broker and proven against the Python broker before cutover.
It is not safe to assume model-output parity merely because both implementations use Whisper and
Kokoro model families.

## Why this stack

Swift 6 language mode makes data-race checks mandatory, while actors provide isolation for shared
mutable state and non-`Sendable` model objects. This is especially useful for a broker that must
serialize Core ML inference while continuing to serve health checks and stream proxy responses.
The [Swift concurrency documentation](https://docs.swift.org/latest/documentation/the-swift-programming-language/concurrency/)
and [Swift 6 migration guide](https://www.swift.org/migration/documentation/migrationguide/) describe
the compiler-enforced isolation model.

[SwiftPM](https://docs.swift.org/main/documentation/packagemanagerdocs/) is the canonical build,
dependency, test, and documentation system. The package should commit `Package.resolved`; release
artifacts should be built from reviewed tags or revisions rather than floating branches.

Hummingbird is a small Apache-2.0 framework built on SwiftNIO. It supports routing, middleware,
streamed request bodies, lifecycle management, and explicit loopback binding. Its official example
binds with `.hostname("127.0.0.1", port: ...)`; request bodies can be bounded with
[`collate(maxSize:)`](https://docs.hummingbird.codes/2.0/documentation/hummingbird/routerguide/).
Its [logging, metrics, and tracing guidance](https://docs.hummingbird.codes/2.0/documentation/hummingbird/loggingmetricsandtracing/)
also permits request logging without headers. Do not enable request logging for this service unless
the privacy properties are verified in a test.

FluidAudio is an Apache-2.0 Swift/Core ML library whose current package uses Swift 6 and targets
macOS 14+. It provides VAD, speaker embedding/known-speaker APIs, ASR, and TTS. Its
[`SpeakerManager`](https://github.com/FluidInference/FluidAudio/blob/main/Documentation/Diarization/SpeakerManager.md)
supports enrollment, cosine-distance matching, and averaged embeddings. However, the currently
documented CAM++ conversion is explicitly beta. FluidAudio reports a 0.48% equal-error rate on a
small, clean AISHELL-1 evaluation and warns that this is easier than real-world CN-Celeb; this is
evidence that the conversion discriminates speakers, not a production threshold for this system.
See the official [FluidAudio benchmark notes](https://github.com/FluidInference/FluidAudio/blob/main/Documentation/Benchmarks.md).

WhisperKit preserves a Whisper-family STT migration path closest to the existing MLX Whisper
behavior. The current implementation lives in Argmax OSS and uses Core ML. The
[published WhisperKit model repository](https://huggingface.co/argmaxinc/whisperkit-coreml) documents
the available converted variants. WhisperKit's top-level model objects are not uniformly `Sendable`,
so the broker must own each instance in an actor rather than bypass Swift 6 checks.

kokoro-coreml is Apache-2.0, targets macOS 15+, returns 24 kHz mono samples, exposes `AsyncStream`
for streaming, and documents a roughly 99 MB first-use model download. Its model is based on
[hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), whose model card declares Apache-2.0.
The package's optional eSpeak trait introduces GPL-3.0 code; leave that trait disabled unless its
licensing and distribution impact is deliberately accepted. The v0.8.0 package manifest also
references an eSpeak package by branch even though the product is trait-gated, so the resolved
commit must be captured and reviewed.

An alternative is to use FluidAudio for VAD, speaker embeddings, ASR, and Kokoro TTS, minimizing
dependencies. That is attractive after benchmarking, but it replaces the current Whisper behavior
with Parakeet and changes the TTS implementation. For the first rewrite, preserving model families
is lower migration risk.

## Proposed package structure

```text
server-swift/
├── Package.swift
├── Package.resolved
├── Sources/
│   ├── VoiceInferenceBroker/       # @main, configuration, lifecycle
│   ├── BrokerHTTP/                 # routes, middleware, DTOs, SSE
│   ├── BrokerCore/                 # errors, limits, protocols, use cases
│   ├── BrokerAudio/                # strict WAV parser and PCM conversion
│   ├── BrokerModels/               # VAD, speaker, WhisperKit, Kokoro actors
│   ├── BrokerSecurity/             # Keychain, bearer verification, enrollment store
│   └── BrokerUpstreams/            # fixed Ollama and Pi clients
├── Tests/
│   ├── BrokerHTTPTests/
│   ├── BrokerAudioTests/
│   ├── BrokerSecurityTests/
│   ├── BrokerContractTests/
│   └── BrokerModelIntegrationTests/
├── FuzzTests/                      # multipart/WAV parser harnesses
├── Models.lock.json                # model source, revision, hashes, license
└── MODEL_PROVENANCE.md
```

Keep model wrappers behind narrow protocols so most tests use deterministic fakes without loading
Core ML. The executable should use dependency injection at startup; routes must not create or
download models. Suggested actor boundaries are `InferenceScheduler`, `SpeakerVerifier`,
`Transcriber`, and `SpeechSynthesizer`. Avoid `@unchecked Sendable` and unbounded
`Task.detached` work.

## Required HTTP compatibility

The present contract is defined by `edge/bot.py`, `server/inference_broker.py`, and the warm-up and
black-box scripts. The Swift broker must pass the existing clients unchanged before cutover.

| Route | Required behavior |
| --- | --- |
| `GET /health` | Require the bearer credential and return `{"status":"ok"}`. An unauthenticated request must remain `401`; readiness should be separate if model readiness is needed. |
| `POST /v1/audio/transcriptions` | Accept one multipart field named `file`; enforce 4 MiB before collation; accept only mono signed PCM16 WAV at 16 kHz and at most 45 seconds; return `{"text":"..."}`. Run VAD and speaker verification before STT. A valid non-owner utterance should return empty text, not enter the LLM pipeline. |
| `POST /v1/audio/speech` | Accept the existing JSON fields `model`, `input`, `voice`, `response_format`, and optional `speed`; enforce 2,000 characters and speed `0.5...2.0`; support only `response_format=pcm`; return headerless little-endian signed PCM16 mono at exactly 24 kHz with `application/octet-stream`. |
| `POST /v1/chat/completions` | Preserve the current Ollama model allowlist, message/role/count/character checks, four-tool allowlist, response status behavior, content type, and byte-for-byte response streaming. Never turn this into a generic proxy. |
| `POST /v1/pi/chat/completions` | Require model `pi-agent`, reject externally supplied tools, preserve message limits, call only the configured loopback Pi `/v1/turn`, and preserve both JSON and OpenAI-compatible SSE response shapes. |

Compatibility details that need explicit tests:

- Pipecat currently requests STT model `mlx-whisper`; the Swift broker may accept that fixed alias
  while internally using a pinned WhisperKit model.
- Pipecat requests TTS voice `alloy`, while benchmark scripts request `af_heart`; the Python broker
  ignores the request voice and always uses its configured voice. The Swift route should preserve
  that behavior with an explicit alias allowlist, not silently enable arbitrary voice selection.
- The current TTS response is raw PCM, not WAV. An accidental WAV header is a breaking change.
- The chat route must stream backpressure-aware chunks and close the upstream response when the
  downstream disconnects.
- Errors should retain the current meaningful `400`, `401`, `413`, `429`, `502`, and `503` classes,
  without exposing model paths, secrets, stack traces, or upstream bodies.

## Speaker-only gate

The intended STT flow is:

```text
bounded multipart body
  -> strict WAV validation
  -> Float32 normalization
  -> VAD / voiced-duration and quality checks
  -> CAM++ embedding
  -> cosine match against enrolled profile
  -> WhisperKit only on accepted speech
```

Enrollment should be an offline CLI or a separate, disabled-by-default loopback administration
mode. It must not be exposed through the Pipecat bearer capability. Require several clean
utterances and a minimum total voiced duration, reject clipped, silent, noisy, or mixed-speaker
samples, L2-normalize each embedding, and average only accepted embeddings. Store the compact
profile plus model identifier, model hash, embedding dimension, threshold, and enrollment version;
delete the source recordings immediately.

Thresholds must be calibrated with held-out recordings from the actual microphone and room. The
evaluation set should include the owner at different distances and speaking styles, other speakers,
TV/podcast speech, background noise, a replay of the owner, and generated speech. Report false
accept rate, false reject rate, and rejection latency. Do not copy a threshold from a clean corpus.

Speaker verification reduces accidental activation and nearby-speaker acceptance. It is not strong
authentication: recordings and generated copies remain credible bypasses. A voice match must not
become the only authorization for destructive approval. Keep the existing proposal/approval
boundary and add a random spoken challenge or macOS user-presence check for sensitive actions.

## Threat model and controls

### Protected assets

- inference broker bearer credential;
- Pi/gateway credentials and fixed upstream capability;
- enrolled voice embedding and its calibration metadata;
- transient microphone audio, transcripts, LLM messages, and synthesized speech;
- Core ML model files and model-selection configuration;
- availability of the single-user inference service.

### Trust boundaries

1. The containerized Pipecat edge is a credentialed but potentially compromiseable caller.
2. The Swift HTTP and multipart/WAV parsers consume attacker-influenced bytes.
3. Core ML libraries and models consume attacker-influenced audio or text.
4. The broker opens fixed outbound connections to Ollama, Pi, and OTLP on loopback.
5. Model assets enter through a software/model supply chain.
6. A per-user LaunchAgent runs with the logged-in user's authority.

### Required controls

**Network and authentication**

- Bind only `127.0.0.1:9443`; never use `0.0.0.0`, Bonjour advertisement, or peer-to-peer
  networking. The Docker host gateway can reach this capability in the current design, so bearer
  authentication is still mandatory.
- Authenticate from request headers before collecting a body or loading a model. Require exactly
  one well-formed `Authorization: Bearer ...` value.
- Do not use ordinary `String ==` for secrets. One defensible implementation stores an HMAC of the
  configured token and verifies a presented token with CryptoKit's
  [`HMAC.isValidAuthenticationCode`](https://developer.apple.com/documentation/cryptokit/hmac),
  avoiding a hand-written timing-sensitive comparison.
- Keep outbound destinations as parsed, immutable startup configuration with exact loopback host,
  port, scheme, and path allowlists. Never accept a URL, header set, or method from the incoming
  payload.

**Resource limits and parsing**

- Reject disallowed methods, routes, content types, missing/duplicate `Content-Length`, chunked
  bodies where unnecessary, oversized headers, extra multipart parts, and oversized bodies before
  allocation. Stream up to the cap rather than trusting declared length.
- Preserve the current 4 MiB audio, 45 second audio, 128 KiB chat, 2,000 TTS character, 64 message,
  and four-tool limits. Add maximum upstream response bytes, response duration, header count/size,
  multipart part count, and connection count.
- Write a fixed-format WAV parser over safe `ByteBuffer`/`Data` operations. Check every RIFF chunk
  length with overflow-reporting arithmetic before slicing or allocating. Require exactly PCM format
  1, mono, 16-bit, 16 kHz, consistent byte rate/block alignment, and a bounded data chunk. Reject
  malformed, overlapping, duplicate, and trailing data instead of passing it to AVFoundation.
- Use one bounded admission controller and one actor-serialized lane per model. Return `429` with a
  small fixed retry hint when saturated; do not accumulate an unbounded waiter list. Apply request,
  inference, upstream-connect, upstream-response, and total deadlines. Cancellation on client
  disconnect must cancel queued work and upstream requests.
- SwiftNIO has had security advisories, including 2026 HTTP header resource-exhaustion and buffer
  issues. Audit the resolved SwiftNIO revision against its
  [official security advisories](https://github.com/apple/swift-nio/security), and enforce an
  application-level header cap even on a patched version.

**Secrets and biometric profile**

- Use Keychain rather than an environment file for the broker bearer token and the compact speaker
  profile. Apple recommends setting `kSecUseDataProtectionKeychain` on macOS. For an unattended
  per-user LaunchAgent, use
  [`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`](https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlockthisdeviceonly):
  it remains unavailable until the first unlock after reboot, works for background access after
  that, and does not migrate to a different device.
- Keychain behavior depends on execution context. Apple's
  [Mac keychain technote](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains)
  distinguishes per-user processes from system daemons. Retain this as a per-user LaunchAgent, not a
  root LaunchDaemon.
- Give profile items a service/account namespace unique to the signed broker. Store no raw
  enrollment audio, transcript, or raw sequence of embeddings. Provide explicit `status`, `delete`,
  and `re-enroll` CLI commands. Deletion should remove the Keychain item and calibration metadata.
- Keychain protects storage and access policy, not a process already compromised while authorized.
  Minimize the broker's other privileges and outbound capabilities accordingly.

**Logging and telemetry**

- Never log authorization headers, request/response bodies, audio, text, transcripts, embeddings,
  distances tied to an identity, model inputs, filesystem paths containing user data, or upstream
  responses. Disable Hummingbird request-header logging.
- Prefer fixed operation names and low-cardinality result classes. Apple's
  [OSLog guidance](https://developer.apple.com/documentation/os/generating-log-messages-from-your-code)
  says sensitive interpolated values should be redacted; for this service, omitting them is safer.
- Hummingbird supports Swift Metrics and Swift Distributed Tracing middleware. Preserve the current
  operation count/duration/error signals, but allow only fixed route/stage labels and export no logs.
  The official [OpenTelemetry Swift](https://github.com/open-telemetry/opentelemetry-swift) packages
  can provide OTLP, but observability dependencies must not block the first functional compatibility
  milestone.

**Model supply chain**

- Do not download a model during the first user request. Provision models during an explicit setup
  step into a broker-owned read-only directory.
- Pin every model repository revision and SHA-256 for every artifact in `Models.lock.json`; verify
  before compile/load. Do not follow a mutable `main` revision at runtime.
- Record original model, converter, conversion revision, artifact digest, declared license, and
  download URL in `MODEL_PROVENANCE.md`. A library license does not license all models it can load.
- FluidAudio's CAM++ card says its weights derive from FunASR CAM++ and that the upstream license
  applies; the conversion is format-only. The
  [FluidAudio CAM++ card](https://huggingface.co/FluidInference/campplus-coreml) therefore needs to be
  recorded alongside the precise upstream provenance rather than summarized only as “FluidAudio is
  Apache-2.0.”
- Restrict model paths to startup configuration beneath the owned model directory. Reject symlinks,
  path traversal, and runtime model identifiers supplied by clients.

**Process isolation**

- A normal SwiftPM executable run by `launchd` is not automatically App Sandbox protected. Apple's
  [App Sandbox documentation](https://developer.apple.com/documentation/security/app-sandbox)
  describes entitlement-based access, including `com.apple.security.network.server` and
  `com.apple.security.network.client`. Do not claim sandbox protection unless the broker is packaged
  and code-signed with tested entitlements.
- A sandboxed distribution needs a signed app/helper layout and explicit network client/server and
  model-container access. That can be a second hardening milestone. The first native replacement can
  be a signed, non-root, per-user executable with minimal filesystem permissions, but it has the
  logged-in user's ambient authority just like the Python broker.
- If sandboxing is introduced, stage all models inside the app container (or a deliberately granted
  container), store secrets in the data-protection Keychain, and verify that Ollama, Pi, OTLP, and
  the Docker host-gateway connection work with only the declared entitlements.

## Core ML and audio handling

Apple states that [Core ML](https://developer.apple.com/documentation/coreml) performs on-device
inference and can use CPU, GPU, and Neural Engine. `MLModelConfiguration.computeUnits` controls the
eligible units. Do not assume Neural Engine use for every converted model: benchmark each selected
artifact with the actual host and configuration, and monitor cold load, warm inference, resident
memory, and contention among VAD, embedding, STT, and TTS.

Load and warm models during readiness startup, outside request handlers. Keep compiled artifacts in
the broker-owned model cache, but be prepared to recompile if a system cache is purged. Fail closed:
if the speaker model/profile is unavailable or incompatible, STT should return `503`, not bypass the
gate.

Internally standardize microphone input to `[Float]` mono at 16 kHz after strict PCM decoding.
Perform no lossy/general media decoding on the HTTP route. Convert Kokoro float samples with finite
checks, clipping to `[-1, 1]`, and explicit little-endian signed PCM16 conversion; assert 24 kHz
before writing a response. Bound total generated samples in addition to input characters.

## Testing and acceptance gates

### Fast tests

- Swift 6 release and debug builds with warnings treated as errors;
- `swift test`, `swift-format lint`, and a dependency/license audit;
- route/method/content-type/auth matrix;
- exact JSON, media type, status, and SSE fixtures for all five routes;
- chat role/model/tool allowlist and size-boundary tests;
- Keychain add/read/update/delete behavior in an isolated test namespace;
- no-sensitive-log assertions using sentinel token/audio/text values;
- cancellation, timeout, queue saturation, and graceful shutdown tests;
- malformed RIFF/multipart property tests and continuous fuzzing with corpus regression cases;
- model missing, corrupt, wrong-hash, wrong-dimension, and wrong-profile-version fail-closed tests.

### Model and system tests

- compare current Python and Swift STT on the same clean/noisy utterance corpus using WER and exact
  task-intent success;
- compare TTS duration, sample format, first-byte latency, real-time factor, subjective voice, and
  Pipecat playback behavior;
- record owner false rejects and impostor/noise/replay/generated-voice false accepts;
- benchmark cold start, warm p50/p95/p99, CPU, GPU/ANE use, peak RSS, and memory after repeated calls;
- black-box the exact Pipecat OpenAI clients, synthetic voice flow, Ollama streaming, Pi JSON/SSE,
  broker restart, host lock/unlock, sleep/wake, and Docker restart;
- demonstrate that concurrent overload returns bounded `429` responses and does not increase memory
  without bound.

Cutover requires all existing `make check`, warm-model, black-box voice, and black-box end-to-end
checks to pass against both implementations. Add a broker-selection environment variable for an
A/B period, then remove Python only after a rollback window.

## Deployment with launchd

Apple recommends `launchd` for per-user background processes and documents that a LaunchAgent is
specific to the logged-in user. A launchd-managed process must stay in the foreground, handle
`SIGTERM`, and avoid self-daemonizing. See Apple's
[Creating Launch Daemons and Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html).

Recommended release deployment:

1. Build with a pinned Swift toolchain and `swift build -c release --disable-sandbox` only where the
   build environment requires that flag; SwiftPM's build sandbox is distinct from macOS App Sandbox.
2. Verify dependency revisions, model hashes, tests, and code-signature metadata.
3. Install the immutable executable mode `0755` in the per-user application-support runtime; keep
   writable models/state in separate mode `0700` directories.
4. Install a mode `0600` LaunchAgent plist whose `ProgramArguments` point directly to the executable,
   not a mutable shell wrapper.
5. Keep stdout/stderr at `/dev/null` or a deliberately privacy-safe sink. Do not place bearer tokens
   in plist arguments or environment variables.
6. Continue binding to loopback and preserve the existing health convergence check.
7. Use `ProcessType=Interactive` only if profiling proves it necessary; do not give broad quality-of-
   service or resource exemptions by default.
8. On shutdown, stop accepting connections, cancel queued work, close upstream clients, and allow
   in-flight requests a short bounded grace period.

Use `KeepAlive` initially for compatibility with the existing service, while considering launchd
socket activation after the Hummingbird listener can safely adopt a passed file descriptor. Do not
change listener semantics during the model/runtime migration.

## Migration risks

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| WhisperKit output differs from MLX Whisper | Intent regressions or different hallucination behavior | Golden corpus, WER/task-intent comparison, threshold/no-speech parity tests, A/B rollback |
| Kokoro Core ML differs from MLX Audio | Voice, pronunciation, or latency regression | Preserve configured voice mapping, subjective test, PCM contract test, benchmark on host |
| CAM++ beta conversion changes | Profile invalidation or FAR/FRR drift | Pin model hash, version profile schema, calibration corpus, explicit re-enrollment migration |
| Core ML resource contention | STT/TTS tail latency and memory spikes | Actor lanes, global admission control, compute-unit benchmark, bounded queue |
| Swift dependency expansion | Supply-chain and patch burden | Exact resolved graph, advisory review, automated update PRs, minimize optional products/traits |
| Automatic model downloads | Mutable/unreviewed code or weights reach production | Offline provisioning, immutable hashes, allowlisted source, fail closed |
| Keychain unavailable before first unlock | Service not ready after reboot | Report `503/not-ready`; never fall back to plaintext or bypass speaker verification |
| App Sandbox assumed but absent | False security boundary | State deployment truth explicitly; package/sign/test entitlements before claiming sandboxing |
| Voice replay/deepfake | Unauthorized utterance passes speaker gate | Treat as personalization, retain task approval controls, challenge/user presence for sensitive work |
| Contract drift in streaming/proxy code | Pipecat or Pi mode breaks | Black-box exact clients, fixture SSE framing, byte-for-byte streaming tests |

## Implementation sequence

1. Create the SwiftPM package, Hummingbird server, configuration parser, Keychain abstraction, strict
   bearer middleware, health route, and privacy-safe telemetry.
2. Implement DTO validation plus fixed Ollama and Pi proxy routes; prove JSON and streaming contract
   parity without any speech models.
3. Implement strict WAV/multipart parsing and Kokoro raw-PCM TTS; run the existing warm-up and
   benchmark scripts against the new port.
4. Integrate WhisperKit and prove STT parity on the existing synthetic and real utterance corpus.
5. Add FluidAudio VAD/CAM++ enrollment and verification, profile schema, delete/re-enroll CLI, and
   fail-closed behavior.
6. Run security, fuzz, FAR/FRR, latency, memory, restart, lock/sleep, and full black-box tests.
7. Deploy in parallel on a different loopback port, switch Pipecat by configuration, retain the
   Python LaunchAgent for rollback, then remove it only after the acceptance window.

## Final recommendation

Proceed with the complete Swift rewrite, but separate “native broker parity” from “only my voice.”
First preserve every existing HTTP/proxy/privacy behavior with Swift 6, Hummingbird, WhisperKit, and
kokoro-coreml. Then enable the pinned FluidAudio CAM++ gate only after enrollment UX and local
false-accept/false-reject calibration pass. Ship initially as a signed per-user LaunchAgent and call
it non-sandboxed; package a signed sandboxed app/helper later if the additional isolation is worth
the deployment complexity.
