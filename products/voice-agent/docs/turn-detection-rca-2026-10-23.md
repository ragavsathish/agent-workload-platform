# Turn detection incident RCA

Date: 2026-10-23  
Status: fix deployed; waiting for a post-fix spoken-turn confirmation

## Summary

Turn detection stopped because the diagnostic Silero VAD subclass raised an
exception on every audio frame. Pipecat 1.12.0's Silero ONNX wrapper returned a
one-element NumPy array for confidence, while our diagnostic recorder converted
that value with `float(array)`. On this Python/NumPy runtime that raises
`TypeError: only 0-dimensional arrays can be converted to Python scalars`.

The exception occurred inside VAD's audio-analysis path before it could finish
evaluating the frame. Pipecat emitted a non-fatal `ErrorFrame` and repeated the
failure for subsequent frames, so the pipeline did not produce VAD decisions or
user-turn events.

## Impact and evidence

- Grafana's **Errors and turn timeouts** panel showed about **1.28k** events in
  the 15-minute window. The corresponding Prometheus series was
  `pipecat_operation_total{app_operation="pipecat.error"}` (1,281.6 on the
  observed query). These were Pipecat pipeline errors, not Grafana query errors.
- The user-turn stop-timeout series
  `pipecat.user_turn.stop_timeout` was zero in that window. The dashboard panel
  groups errors and turn timeouts, but the timeout metric did not account for
  this incident.
- The latest diagnostic capture ran from 19:38:01 to 19:38:57 UTC and contained
  667 audio metric points, zero VAD samples, and only bot-speech start/stop
  markers. Its raw audio level was mostly near silence (median −90.9 dBFS), so
  the capture alone cannot prove that a spoken phrase was present.
- Edge logs during that capture repeatedly reported the conversion exception
  at `audio_diagnostics.py:197`, followed by Pipecat `ErrorFrame`s. Near the end
  the SmallWebRTC reader cleared the media track.
- The failure affected the VAD analyzer's processing path, not just storage of
  optional diagnostic values: the diagnostic sample recording ran directly
  from `_get_smoothed_volume`, which Pipecat calls while evaluating VAD frames.

## Root cause

`DiagnosticSileroVADAnalyzer.voice_confidence` passed Silero's raw model output
through unchanged. Although Pipecat annotates this method as returning `float`,
the installed model returned a one-element NumPy array. The inherited analyzer
could compare that one-element value, but our diagnostic callback passed it to
`float()` in `SessionAudioRecorder.record_vad_sample`; that conversion raised
for every frame.

## Why Grafana showed the symptom without the cause

The OTel `ErrorObserver` intentionally records only a fixed operation name and
outcome; it drops exception text to keep telemetry free of voice content and
unbounded error data. Grafana therefore showed the count, while the container
log was needed to identify the exception. Grafana health returned HTTP 200,
Prometheus and Tempo queries succeeded, and the collector reported no refused
spans in the checked window. No Grafana datasource timeout was reproduced.

## Resolution

`DiagnosticSileroVADAnalyzer.voice_confidence` now converts the single model
value to a Python scalar with `numpy.asarray(...).item()` before returning it.
This matches Pipecat's declared return type and keeps the value safe for both
VAD threshold comparisons and diagnostic sampling. A unit assertion now checks
that the recorded confidence is scalar `0.9`.

## Verification

- Ruff passed for the edge package.
- Targeted Pyright for `diagnostic_vad.py` and `test_diagnostic_vad.py` passed.
- Package-wide Pyright still reports two unrelated NumPy `float32` argument
  type mismatches in `test_audio_diagnostics.py`; the changed files pass.
- All 51 edge unit tests passed.
- The edge image was rebuilt and the container restarted at 19:44:46 UTC; it is
  healthy. Grafana health remains HTTP 200.
- The `pipecat.error` increase was zero in the two minutes after restart, and
  the new container logs contained no matching conversion or frame errors.

No spoken interaction has been run against the newly deployed container yet.
The next spoken diagnostic capture should have non-empty VAD samples; its
`vad_speech_started`, `transcript_emitted`, and user-turn markers will confirm
the full path.

## Relevant code

- `apps/edge/diagnostic_vad.py`: scalar conversion at the Silero boundary.
- `apps/edge/audio_diagnostics.py`: recorder conversion that exposed the bug.
- `apps/edge/bot.py`: VAD analyzer wiring and payload-free user-turn events.
- `apps/edge/otel_bridge.py`: Pipecat observer counters.
- `deploy/observability/pipecat-overview.json`: Grafana voice-journey and
  error/timeout panels.
