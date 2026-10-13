"""Pipecat TTS adapter backed by MLX Audio on Apple Silicon."""

import asyncio
import sys
import threading
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, cast

import numpy as np
from loguru import logger
from mlx_audio.tts.utils import load
from pipecat.audio.utils import create_stream_resampler
from pipecat.frames.frames import ErrorFrame, Frame, TTSAudioRawFrame
from pipecat.services.settings import TTSSettings
from pipecat.services.tts_service import TTSService
from pipecat.utils.tracing.service_decorators import traced_tts
from pipecat.utils.types import NOT_GIVEN, NotGiven, assert_given, require_given


def _disable_broken_macos_espeak_fallback() -> None:
    """Keep Kokoro alive when espeakng-loader ships unusable macOS data paths.

    Misaki only uses espeak for out-of-dictionary English words.  The packaged
    macOS library can call exit(0) while initializing its fallback, which kills
    an executor thread and leaves the broker request pending forever.  Raising
    a normal exception lets Kokoro use Misaki's primary English G2P safely.
    """
    if sys.platform != "darwin":
        return

    import misaki.espeak

    class UnavailableEspeakFallback:
        def __init__(self, *args: object, **kwargs: object) -> None:
            raise RuntimeError("espeak fallback is disabled on macOS")

    misaki.espeak.EspeakFallback = UnavailableEspeakFallback


_disable_broken_macos_espeak_fallback()


@lru_cache(maxsize=2)
def _load_model(model_name: str) -> Any:
    """Load each model once, even when Pipecat creates a service per session."""
    logger.info("Loading MLX TTS model [{}]", model_name)
    return load(model_name)


_MODEL_LOCK = threading.Lock()


def synthesize_pcm(
    *,
    text: str,
    model_name: str,
    voice: str,
    speed: float,
    lang_code: str,
    streaming_interval: float,
) -> tuple[bytes, int]:
    """Generate bounded-call PCM for the isolated inference broker."""
    model = _load_model(model_name)
    chunks: list[bytes] = []
    sample_rate: int | None = None
    with _MODEL_LOCK:
        results = model.generate(
            text=text,
            voice=voice,
            speed=speed,
            lang_code=lang_code,
            stream=True,
            streaming_interval=streaming_interval,
        )
        for result in results:
            samples = np.asarray(result.audio, dtype=np.float32).reshape(-1)
            audio = np.clip(samples, -1.0, 1.0)
            chunks.append((audio * 32767.0).astype(np.int16).tobytes())
            current_rate = int(result.sample_rate)
            if sample_rate is not None and current_rate != sample_rate:
                raise RuntimeError("TTS model changed sample rate during generation")
            sample_rate = current_rate
    if sample_rate is None:
        raise RuntimeError("TTS model returned no audio")
    return b"".join(chunks), sample_rate


@dataclass
class MLXAudioTTSSettings(TTSSettings):
    """Runtime settings specific to MLX Audio."""

    speed: float | NotGiven = field(default_factory=lambda: NOT_GIVEN)
    lang_code: str | NotGiven = field(default_factory=lambda: NOT_GIVEN)
    streaming_interval: float | NotGiven = field(default_factory=lambda: NOT_GIVEN)


class MLXAudioTTSService(TTSService):
    """Stream locally generated MLX Audio speech into a Pipecat pipeline."""

    Settings = MLXAudioTTSSettings

    def __init__(self, *, settings: Settings | None = None, **kwargs):
        defaults = self.Settings(
            model="mlx-community/Kokoro-82M-bf16",
            voice="af_heart",
            language=None,
            speed=1.0,
            lang_code="a",
            streaming_interval=0.5,
        )
        if settings is not None:
            defaults.apply_update(settings)

        super().__init__(
            push_start_frame=True,
            push_stop_frames=True,
            settings=defaults,
            **kwargs,
        )
        model_name = require_given(self._settings.model, "MLX TTS model")
        self._model: Any = _load_model(model_name)
        self._resampler = create_stream_resampler()

    def can_generate_metrics(self) -> bool:
        return True

    @traced_tts
    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame, None]:
        """Generate speech off the event loop and emit PCM chunks as they arrive."""
        queue: asyncio.Queue[tuple[np.ndarray, int] | Exception | None] = asyncio.Queue()
        loop = asyncio.get_running_loop()

        settings = cast(MLXAudioTTSSettings, self._settings)
        voice = require_given(settings.voice, "MLX TTS voice")
        speed = assert_given(settings.speed)
        lang_code = assert_given(settings.lang_code)
        streaming_interval = assert_given(settings.streaming_interval)

        def generate() -> None:
            try:
                # MLX model execution is serialized. This personal deployment is
                # intentionally single-user; the lock also protects accidental overlap.
                with _MODEL_LOCK:
                    results = self._model.generate(
                        text=text,
                        voice=voice,
                        speed=speed,
                        lang_code=lang_code,
                        stream=True,
                        streaming_interval=streaming_interval,
                    )
                    for result in results:
                        samples = np.asarray(result.audio, dtype=np.float32).reshape(-1)
                        loop.call_soon_threadsafe(
                            queue.put_nowait,
                            (samples, int(result.sample_rate)),
                        )
            except Exception as exc:  # forwarded to the async consumer
                loop.call_soon_threadsafe(queue.put_nowait, exc)
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        await self.start_tts_usage_metrics(text)
        producer = asyncio.create_task(asyncio.to_thread(generate))

        try:
            while True:
                item: Any = await queue.get()
                if item is None:
                    break
                if isinstance(item, Exception):
                    raise item

                samples, source_rate = item
                audio = np.clip(samples, -1.0, 1.0)
                pcm = (audio * 32767.0).astype(np.int16).tobytes()
                pcm = await self._resampler.resample(pcm, source_rate, self.sample_rate)

                await self.stop_ttfb_metrics()
                yield TTSAudioRawFrame(
                    audio=pcm,
                    sample_rate=self.sample_rate,
                    num_channels=1,
                    context_id=context_id,
                )
        except Exception as exc:
            logger.exception("MLX TTS generation failed")
            yield ErrorFrame(error=f"MLX TTS generation failed: {exc}")
        finally:
            await producer
            await self.stop_ttfb_metrics()
