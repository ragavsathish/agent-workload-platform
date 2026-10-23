"""Observe the actual Silero decisions against the filtered replay clock."""

from __future__ import annotations

import numpy as np
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams, VADState

from audio_filter import SelectedReplayAudioFilter


class DiagnosticSileroVADAnalyzer(SileroVADAnalyzer):
    def __init__(self, audio_filter: SelectedReplayAudioFilter, *, params: VADParams) -> None:
        super().__init__(params=params)
        self._audio_filter = audio_filter
        self._processed_frames = 0
        self._last_confidence = 0.0
        self._speech_reported = False

    @property
    def audio_time_seconds(self) -> float:
        return self._processed_frames / self.sample_rate if self.sample_rate else 0.0

    def voice_confidence(self, buffer: bytes) -> float:
        # Silero's ONNX wrapper returns a one-element ndarray in Pipecat 1.12.0,
        # despite the analyzer contract being a float. Keep the value scalar so
        # diagnostics can record it and the base analyzer can compare it safely.
        self._last_confidence = float(np.asarray(super().voice_confidence(buffer)).item())
        return self._last_confidence

    def _get_smoothed_volume(self, audio: bytes) -> float:
        volume = super()._get_smoothed_volume(audio)
        self._processed_frames += len(audio) // 2
        self._audio_filter.record_vad_sample(
            self.audio_time_seconds, self._last_confidence, volume
        )
        return volume

    async def analyze_audio(self, buffer: bytes) -> VADState:
        state = await super().analyze_audio(buffer)
        if state == VADState.SPEAKING and not self._speech_reported:
            self._audio_filter.record_event("vad_speech_started", self.audio_time_seconds)
            self._speech_reported = True
        elif state == VADState.QUIET and self._speech_reported:
            self._audio_filter.record_event("vad_speech_stopped", self.audio_time_seconds)
            self._speech_reported = False
        return state
