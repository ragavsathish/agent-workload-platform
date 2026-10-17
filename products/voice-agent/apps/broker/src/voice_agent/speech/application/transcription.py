"""Pure, payload-free post-processing for speech-to-text results."""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any

import numpy as np
from voice_agent.speech.infrastructure.parakeet_stt import transcribe_pcm

inference_slot = asyncio.Semaphore(1)


@dataclass(frozen=True)
class TranscriptResult:
    text: str
    outcome: str
    filtered_segments: int = 0


def extract_transcript(result: dict[str, Any]) -> TranscriptResult:
    """Extract accepted text while returning only bounded diagnostic metadata."""
    segments = result.get("segments")
    if not isinstance(segments, list):
        text = str(result.get("text", "")).strip()
        return TranscriptResult(text, "emitted" if text else "model_empty")

    accepted: list[str] = []
    filtered = 0
    for segment in segments:
        if not isinstance(segment, dict):
            filtered += 1
            continue
        text = str(segment.get("text", "")).strip()
        if not text or float(segment.get("no_speech_prob", 0.0)) >= 0.6:
            filtered += 1
            continue
        accepted.append(text)

    text = " ".join(accepted).strip()
    if text:
        return TranscriptResult(text, "emitted", filtered)
    return TranscriptResult("", "filtered_empty" if segments else "model_empty", filtered)


async def transcribe_audio(audio: np.ndarray) -> TranscriptResult:
    """Serialize model inference and return the accepted transcript."""
    async with inference_slot:
        result = await asyncio.to_thread(
            transcribe_pcm,
            audio,
            model_id=os.environ["MLX_STT_MODEL"],
        )
    return extract_transcript(result)
