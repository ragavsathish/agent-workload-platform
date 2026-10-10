# Security policy and threat model

## Security boundary

The broker is a per-user, loopback-only capability. The Pipecat container is authenticated but is
not trusted with arbitrary network proxying, model selection, filesystem access, enrollment, or
administration. Outbound connections are fixed at startup to loopback Ollama and Pi endpoints.

Voice matching reduces accidental activation and nearby-speaker acceptance. It does **not** resist
recordings or generated voice clones and must never authorize destructive actions. Those continue
through the existing proposal/approval boundary and should eventually require a random spoken
challenge or macOS user-presence confirmation.

## Mandatory controls before cutover

- Keep the listener on `127.0.0.1` or `::1`; never advertise it with Bonjour.
- Read the broker credential from the Data Protection Keychain in production. Environment input is
  a migration facility, not the final secret distribution design.
- Use a distinct administration credential for enrollment; the Pipecat credential cannot enroll,
  replace, inspect, or delete a profile.
- Accept no body before authentication; cap headers, connections, body bytes, inference queue
  depth, upstream response bytes, and all timeouts.
- Accept only the documented PCM and JSON shapes. Never deserialize arbitrary types or accept an
  inbound upstream URL, path, method, or header map.
- Keep raw audio, transcripts, messages, tokens, and embeddings out of logs and traces. Emit only
  bounded status, duration, and error-class metrics.
- Store only the averaged normalized speaker embedding and calibration metadata. Delete enrollment
  recordings immediately and never update a profile from live traffic.
- Pre-provision models and verify immutable revision, artifact hash, conversion process, and
  license. Startup fails closed when an authorized artifact is absent or changed.
- Sign and notarize release artifacts. A plain SwiftPM LaunchAgent is not App Sandbox protected;
  do not claim sandboxing until a signed app/helper and tested entitlements exist.
- Audit every resolved dependency, particularly SwiftNIO, against its official security advisories.

## Cutover gate

The Swift broker may replace Python only after contract tests cover all five endpoints, model tests
run offline, malformed WAV/multipart fuzzing passes, and A/B measurements cover latency, transcript
quality, false accept/reject rates, replayed owner audio, generated speech, TV/podcast speech, and
room noise. Rollback remains the existing Python LaunchAgent until the observation period ends.

Report vulnerabilities privately to the repository owner. Do not attach credentials, voice
recordings, embeddings, or transcripts to an issue.
