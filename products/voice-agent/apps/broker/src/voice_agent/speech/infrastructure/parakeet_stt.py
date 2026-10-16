"""Persistent Parakeet MLX speech-to-text adapter."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

import mlx.core as mx
import numpy as np
from parakeet_mlx import from_pretrained
from parakeet_mlx.audio import get_logmel


@lru_cache(maxsize=1)
def load_model(model_id: str) -> Any:
    """Load one process-wide MLX model instead of rebuilding it for every turn."""
    return from_pretrained(model_id)


def transcribe_pcm(audio: np.ndarray, *, model_id: str) -> dict[str, str]:
    """Transcribe normalized 16 kHz mono PCM using the configured Parakeet model."""
    model = load_model(model_id)
    mel = get_logmel(mx.array(audio), model.preprocessor_config)
    results = model.generate(mel)
    text = str(results[0].text).strip() if results else ""
    return {"text": text}
