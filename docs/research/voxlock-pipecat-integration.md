# VoxLock integration and validation

Status: implemented as an opt-in Pipecat input filter. Updated 2026-10-14.

## Purpose and boundary

VoxLock isolates an enrolled target speaker before Pipecat performs Silero VAD,
Smart Turn analysis, or Whisper transcription. It is intended to reduce false
turns caused by television speech and nearby people. It is not authentication,
liveness detection, or authorization: replayed or similar speech can still pass.

The integration preserves RNNoise as the default and rollback path:

```text
Browser microphone
  -> selected Pipecat input filter (RNNoise or VoxLock)
  -> Silero VAD and Smart Turn
  -> MLX Whisper
  -> Pi agent
  -> Kokoro TTS
```

Pipecat exposes one `audio_in_filter` slot, so the filters are alternatives;
they are not implicitly chained.

## Reproducible model delivery

The edge dependency is locked to `voxlock[pipecat]==1.1.0`. Image construction
downloads the two required ONNX files from the immutable model revision
`a50f4e1d109301d4b6f61dec57ebb1a61e7d8f03` and rejects a digest mismatch:

| File | SHA-256 |
|---|---|
| `enroll.onnx` | `86645cba23f207def0b31a6e74a615d3b7a813b4fdf957c53b3af2905ba2ffd3` |
| `chunk_int8.onnx` | `f0d2b0aaf95affe8894ea008d0105be4f5f5354f7244835534c31b1a7dd4699a` |

The image also records model repository, revision, license, and hashes in
`/app/models/voxlock/provenance.json`, initializes the model during the build,
and sets `HF_HUB_OFFLINE=1` at runtime. The read-only edge therefore has no
first-call model download and needs no Hugging Face token.

## Enrollment sample

Set these values in the ignored `products/voice-agent/deploy/.env`:

```dotenv
VOICE_INPUT_FILTER=voxlock
VOXLOCK_VOICE_SAMPLE_SOURCE=/absolute/path/to/owner.wav
```

The source must be mono, 16 kHz, PCM16 WAV and contain at least three seconds.
`deploy/prepare_compose.py` examines at most the first 15 seconds, selects its
loudest contiguous three seconds, and writes:

```text
products/voice-agent/deploy/secrets/voxlock-voice-sample.wav
```

That derived file is ignored by Git, mode `0600`, and mounted only into the
voice edge as `/run/secrets/voxlock-voice-sample`. The source path, samples,
audio, embeddings, and identity are not exported to logs or telemetry.

Prefer clean speech with no television, music, or second speaker. Listen to the
exact derived sample before deployment:

```bash
afplay products/voice-agent/deploy/secrets/voxlock-voice-sample.wav
afinfo products/voice-agent/deploy/secrets/voxlock-voice-sample.wav
```

## Deploy and verify integrity

```bash
cd products/voice-agent
make up
make verify
```

`make verify` checks that `/api/features` reports the configured filter as
ready and, in VoxLock mode, confirms the secret and required model files exist.
The endpoint should expose:

```json
{"audioFilter":{"name":"voxlock","ready":true}}
```

Unit and repository checks run with:

```bash
make check
```

## Validate isolation quality

Integrity checks prove that the pinned model loaded; they do not prove that it
separates a particular room. Run each scenario at least five times with the
same owner phrase:

| Scenario | Required observation |
|---|---|
| Owner in a quiet room | Accurate transcript and response |
| Television only for 60 seconds | No transcript and no response |
| Owner overlapping television | Owner phrase retained; television words absent |
| Another person speaking | No submitted turn |
| Normal phone distance and volume | Consistent owner acceptance |

A useful initial acceptance gate is zero television-only turns, no filter
errors, no material owner-word regression relative to RNNoise, and filter
processing that remains well below the configured 80 ms chunk budget.

For an A/B comparison, run the same matrix with `VOICE_INPUT_FILTER=rnnoise`,
recreate the edge, record results, restore `voxlock`, and recreate it again.

## Payload-free telemetry

The adapter records fixed-cardinality lifecycle and processing metrics:

- `audio.filter.voxlock.start`
- `audio.filter.voxlock.process` with `buffered`, `emitted`, or `error`
- `audio.filter.voxlock.stop`

No metric contains audio, transcripts, sample paths, embeddings, scores, or
speaker identity. Consequently, telemetry proves operational health and cost,
but not separation quality. Room-level rejection must be established by the
controlled scenarios above.

Useful Prometheus expressions include:

```promql
sum(increase(pipecat_operation_total{
  app_operation="audio.filter.voxlock.process",
  app_outcome="error"
}[15m]))
```

```promql
sum(increase(pipecat_operation_total{
  app_operation="pipecat.user_turn.transcript_emitted"
}[5m]))
```

The second expression should remain zero during a television-only interval.
Use duration sum/count for current average processing latency. The existing
default histogram has coarse duration buckets and must not be used to claim a
sub-second p95 until those buckets are refined.

## Runtime characteristics and rollback

VoxLock uses local CPU ONNX inference, not MLX or Metal. Each call gets a fresh
filter so stream state is not shared between sessions. The configured 80 ms
chunks use two ONNX threads within the edge's two-vCPU and 2 GiB limits.

To roll back:

```dotenv
VOICE_INPUT_FILTER=rnnoise
```

Then recreate the edge and run `make verify`. No database or enrollment-data
migration is required; the derived sample remains an ignored local secret and
can be deleted independently.

## Primary upstream references

- [VoxLock 1.1.0 release](https://github.com/arbazsiddiqui/voxlock/releases/tag/v1.1.0)
- [VoxLock Pipecat adapter](https://github.com/arbazsiddiqui/voxlock/blob/4fa9a3afd8d288243c9cfa9fbf5b2fc9a491cf3f/voxlock/pipecat.py)
- [Pinned model revision](https://huggingface.co/arbazsiddiqui/voxlock/tree/a50f4e1d109301d4b6f61dec57ebb1a61e7d8f03)
- [Pipecat input filters](https://docs.pipecat.ai/server/services/transport/audio-filters)
