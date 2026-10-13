"""Select and instrument the server-side input audio filter."""

from __future__ import annotations

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

VOICE_SAMPLE_PATH = Path("/run/secrets/voxlock-voice-sample")
VOXLOCK_MODEL_PATH = Path("/app/models/voxlock")
SUPPORTED_FILTERS = frozenset({"rnnoise", "voxlock"})


class InstrumentedAudioFilter(BaseAudioFilter):
    """Record bounded filter lifecycle metrics without audio or identity data."""

    def __init__(self, name: str, delegate: BaseAudioFilter, telemetry: Telemetry) -> None:
        self.name = name
        self._delegate = delegate
        self._telemetry = telemetry

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
            self._telemetry.record(
                f"audio.filter.{self.name}.process",
                outcome="error",
                duration_seconds=monotonic() - started,
            )
            raise
        self._telemetry.record(
            f"audio.filter.{self.name}.process",
            outcome="emitted" if filtered else "buffered",
            duration_seconds=monotonic() - started,
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


def create_audio_filter(telemetry: Telemetry) -> InstrumentedAudioFilter:
    name = selected_filter_name()
    if name == "voxlock":
        delegate: BaseAudioFilter = VoxLockFilter(
            voice_sample=load_owner_voice_sample(),
            model_dir=str(VOXLOCK_MODEL_PATH),
            precision="int8",
            chunk_ms=80,
            threads=2,
        )
    else:
        delegate = RNNoiseFilter()
    return InstrumentedAudioFilter(name, delegate, telemetry)


def audio_filter_readiness() -> dict[str, object]:
    name = selected_filter_name()
    if name == "voxlock":
        required_models = ("enroll.onnx", "chunk_int8.onnx", "provenance.json")
        if any(not (VOXLOCK_MODEL_PATH / model).is_file() for model in required_models):
            raise RuntimeError("VoxLock model files are missing")
        load_owner_voice_sample()
    return {"name": name, "ready": True}
