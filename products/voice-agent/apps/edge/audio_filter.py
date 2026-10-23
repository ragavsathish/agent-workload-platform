"""Select and instrument the server-side input audio filter."""

from __future__ import annotations

import asyncio
import math
import os
from functools import lru_cache
from pathlib import Path
from time import monotonic

import numpy as np
from pipecat.audio.filters.base_audio_filter import BaseAudioFilter
from pipecat.audio.filters.rnnoise_filter import RNNoiseFilter
from pipecat.frames.frames import FilterControlFrame
from voice_agent.shared.telemetry import Telemetry
from voxlock import load_audio, loud_sample
from voxlock.pipecat import VoxLockFilter

from audio_diagnostics import SessionAudioRecorder, audio_diagnostic_store

VOICE_SAMPLE_PATH = Path("/run/secrets/voxlock-voice-sample")
VOXLOCK_MODEL_PATH = Path("/app/models/voxlock")
SUPPORTED_FILTERS = frozenset({"rnnoise", "voxlock"})


class InstrumentedAudioFilter(BaseAudioFilter):
    """Record bounded filter lifecycle metrics without audio or identity data."""

    def __init__(self, name: str, delegate: BaseAudioFilter, telemetry: Telemetry) -> None:
        self.name = name
        self._delegate = delegate
        self._telemetry = telemetry
        self.last_duration_ms = 0.0

    async def start(self, sample_rate: int):
        with self._telemetry.observe(f"audio.filter.{self.name}.start"):
            await self._delegate.start(sample_rate)

    async def stop(self):
        with self._telemetry.observe(f"audio.filter.{self.name}.stop"):
            await self._delegate.stop()

    async def process_frame(self, frame: FilterControlFrame):
        await self._delegate.process_frame(frame)

    async def filter(self, audio: bytes) -> bytes:
        started = monotonic()
        try:
            filtered = await self._delegate.filter(audio)
        except BaseException:
            self.last_duration_ms = (monotonic() - started) * 1000
            self._telemetry.record(
                f"audio.filter.{self.name}.process",
                outcome="error",
                duration_seconds=self.last_duration_ms / 1000,
            )
            raise
        self.last_duration_ms = (monotonic() - started) * 1000
        self._telemetry.record(
            f"audio.filter.{self.name}.process",
            outcome="emitted" if filtered else "buffered",
            duration_seconds=self.last_duration_ms / 1000,
        )
        return filtered


def selected_filter_name() -> str:
    name = os.getenv("VOICE_INPUT_FILTER", "rnnoise").strip().lower()
    if name not in SUPPORTED_FILTERS:
        supported = ", ".join(sorted(SUPPORTED_FILTERS))
        raise RuntimeError(f"VOICE_INPUT_FILTER must be one of: {supported}")
    return name


@lru_cache(maxsize=1)
def load_owner_voice_sample(path: Path = VOICE_SAMPLE_PATH) -> np.ndarray:
    if not path.is_file():
        raise RuntimeError("VoxLock owner voice sample is missing")
    audio = load_audio(path)
    if len(audio) < 3 * 16_000:
        raise RuntimeError("VoxLock owner voice sample must contain at least three seconds")
    sample = loud_sample(audio, sec=3.0, within=15.0)
    if len(sample) != 3 * 16_000 or not np.isfinite(sample).all():
        raise RuntimeError("VoxLock owner voice sample is invalid")
    if float(np.max(np.abs(sample))) < 1e-4:
        raise RuntimeError("VoxLock owner voice sample contains no usable speech")
    sample.setflags(write=False)
    return sample


class _DiagnosticOnnxSession:
    """Expose the instrumented ONNX mask while preserving VoxLock's 3-output API."""

    def __init__(self, delegate: object) -> None:
        self._delegate = delegate
        self.last_mask: np.ndarray | None = None

    def run(self, _outputs: object, inputs: dict[str, np.ndarray]) -> list[np.ndarray]:
        run = getattr(self._delegate, "run")
        results = run(["frames", "h_out", "c_out", "diagnostic_mask"], inputs)
        self.last_mask = results[3]
        return results[:3]


class DiagnosticVoxLockFilter(VoxLockFilter):
    """Pinned VoxLock adapter exposing bounded, aggregate model diagnostics."""

    _diagnostic_session: _DiagnosticOnnxSession | None = None

    async def start(self, sample_rate: int):
        await super().start(sample_rate)
        model = getattr(self, "_vl", None)
        if model is None:
            raise RuntimeError("VoxLock model did not initialize")
        self._diagnostic_session = _DiagnosticOnnxSession(model.chunk)
        model.chunk = self._diagnostic_session

    def diagnostic_state(self) -> dict[str, object]:
        stream = getattr(self, "_stream", None)
        hidden = getattr(stream, "h", None)
        cell = getattr(stream, "c", None)
        mask = None if self._diagnostic_session is None else self._diagnostic_session.last_mask
        result: dict[str, object] = {}
        if isinstance(hidden, np.ndarray) and isinstance(cell, np.ndarray):
            result["lstmHiddenRms"] = [
                round(float(np.sqrt(np.mean(layer * layer))), 6) for layer in hidden
            ]
            result["lstmCellRms"] = [
                round(float(np.sqrt(np.mean(layer * layer))), 6) for layer in cell
            ]
        if isinstance(mask, np.ndarray) and mask.ndim == 5 and mask.shape[2] == 2:
            magnitude = np.sqrt(mask[0, 0, 0] ** 2 + mask[0, 0, 1] ** 2).mean(axis=1)
            result["maskMagnitude"] = [
                round(float(group.mean()), 4) for group in np.array_split(magnitude, 32)
            ]
        return result


def _voxlock_filter(telemetry: Telemetry) -> InstrumentedAudioFilter:
    return InstrumentedAudioFilter(
        "voxlock",
        DiagnosticVoxLockFilter(
            voice_sample=load_owner_voice_sample(),
            model_dir=str(VOXLOCK_MODEL_PATH),
            precision="int8",
            chunk_ms=80,
            threads=2,
        ),
        telemetry,
    )


class SelectedReplayAudioFilter(BaseAudioFilter):
    """Run only the selected filter and retain its bounded diagnostics."""

    def __init__(self, selected: str, telemetry: Telemetry) -> None:
        self.name = selected
        self._telemetry = telemetry
        self._filter = (
            _voxlock_filter(telemetry)
            if selected == "voxlock"
            else InstrumentedAudioFilter("rnnoise", RNNoiseFilter(), telemetry)
        )
        self._recorder: SessionAudioRecorder | None = None
        self._sample_rate = 0
        self._input_frames = 0
        self._metric_raw_pending = b""

    async def start(self, sample_rate: int):
        await self._filter.start(sample_rate)
        self._sample_rate = sample_rate
        self._input_frames = 0
        self._metric_raw_pending = b""
        self._recorder = audio_diagnostic_store().begin(
            sample_rate=sample_rate,
            selected_filter=self.name,
        )

    async def stop(self):
        try:
            await self._filter.stop()
        finally:
            recorder, self._recorder = self._recorder, None
            if recorder is not None:
                await asyncio.to_thread(recorder.close)

    async def process_frame(self, frame: FilterControlFrame):
        await self._filter.process_frame(frame)

    def record_vad_sample(self, time_seconds: float, confidence: float, volume: float) -> None:
        if self._recorder is not None:
            self._recorder.record_vad_sample(time_seconds, confidence, volume)

    def record_event(self, kind: str, time_seconds: float | None = None) -> None:
        if self._recorder is not None:
            self._recorder.record_event(
                kind,
                self._recorder.audio_time_seconds if time_seconds is None else time_seconds,
            )

    async def filter(self, audio: bytes) -> bytes:
        filtered = await self._filter.filter(audio)
        self._input_frames += len(audio) // 2
        self._metric_raw_pending += audio
        if self._recorder is not None:
            delegate = self._filter._delegate
            model_state = (
                delegate.diagnostic_state()
                if filtered and isinstance(delegate, DiagnosticVoxLockFilter)
                else {}
            )
            metrics = None
            if filtered:
                metrics = {
                    "timeSeconds": round(self._input_frames / self._sample_rate, 3),
                    "rawDbfs": _dbfs(self._metric_raw_pending),
                    f"{self.name}Dbfs": _dbfs(filtered),
                    f"{self.name}SuppressionDb": _suppression_db(
                        self._metric_raw_pending, filtered
                    ),
                    f"{self.name}LatencyMs": round(self._filter.last_duration_ms, 3),
                    **model_state,
                }
                self._metric_raw_pending = b""
            self._recorder.record(
                raw=audio,
                filtered=filtered,
                metrics=metrics,
            )
        return filtered


def _dbfs(audio: bytes) -> float | None:
    if not audio:
        return None
    samples = np.frombuffer(audio, dtype=np.int16).astype(np.float32) / 32768
    rms = float(np.sqrt(np.mean(samples * samples)))
    return round(max(-100.0, 20 * math.log10(max(rms, 1e-5))), 3)


def _suppression_db(input_audio: bytes, output_audio: bytes) -> float | None:
    input_dbfs = _dbfs(input_audio)
    output_dbfs = _dbfs(output_audio)
    if input_dbfs is None or output_dbfs is None:
        return None
    return round(input_dbfs - output_dbfs, 3)


def create_audio_filter(telemetry: Telemetry) -> SelectedReplayAudioFilter:
    return SelectedReplayAudioFilter(selected_filter_name(), telemetry)


def audio_filter_readiness() -> dict[str, object]:
    name = selected_filter_name()
    if name == "voxlock":
        required_models = ("enroll.onnx", "chunk_int8.onnx", "provenance.json")
        if any(not (VOXLOCK_MODEL_PATH / model).is_file() for model in required_models):
            raise RuntimeError("VoxLock model files are missing")
        load_owner_voice_sample()
    return {"name": name, "ready": True}
