"""Narrow host-only inference API for the isolated edge VM.

The broker intentionally exposes no generic proxy, filesystem, shell, task queue,
session, or model-selection surface. It must remain bound to loopback and is reached
from the guest only through an SSH reverse-forward initiated by the host.
"""

from __future__ import annotations

import asyncio
import json
import os
import secrets
import wave
from contextlib import asynccontextmanager
from io import BytesIO
from typing import Annotated, Any, cast

import httpx
import mlx_whisper
import numpy as np
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from loguru import logger
from pydantic import BaseModel, Field

from mlx_tts import synthesize_pcm

# The broker handles raw voice data. Do not emit library or application logs from this process.
logger.remove()

load_dotenv(os.getenv("INFERENCE_BROKER_ENV_FILE", ".env"), override=True)

MAX_AUDIO_BYTES = int(os.getenv("BROKER_MAX_AUDIO_BYTES", "4194304"))
MAX_CHAT_BYTES = int(os.getenv("BROKER_MAX_CHAT_BYTES", "131072"))
MAX_TTS_CHARS = int(os.getenv("BROKER_MAX_TTS_CHARS", "2000"))
MAX_AUDIO_SECONDS = int(os.getenv("BROKER_MAX_AUDIO_SECONDS", "45"))
BROKER_TOKEN = os.getenv("INFERENCE_BROKER_TOKEN", "")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1").rstrip("/")

if len(BROKER_TOKEN) < 32:
    raise RuntimeError("INFERENCE_BROKER_TOKEN must contain at least 32 characters")
if not OLLAMA_MODEL:
    raise RuntimeError("OLLAMA_MODEL is required")

_inference_slot = asyncio.Semaphore(1)


async def authenticate(authorization: Annotated[str | None, Header()] = None) -> None:
    expected = f"Bearer {BROKER_TOKEN}"
    if authorization is None or not secrets.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="invalid broker credential")


def _decode_wav(content: bytes) -> np.ndarray:
    try:
        with wave.open(BytesIO(content), "rb") as source:
            channels = source.getnchannels()
            width = source.getsampwidth()
            rate = source.getframerate()
            frames = source.getnframes()
            if channels != 1 or width != 2 or rate != 16000:
                raise HTTPException(status_code=400, detail="audio must be mono 16-bit PCM at 16kHz")
            if frames > rate * MAX_AUDIO_SECONDS:
                raise HTTPException(status_code=413, detail="audio segment is too long")
            raw = source.readframes(frames)
    except (wave.Error, EOFError) as exc:
        raise HTTPException(status_code=400, detail="invalid WAV payload") from exc
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


class SpeechRequest(BaseModel):
    model: str = Field(max_length=64)
    input: str = Field(min_length=1, max_length=MAX_TTS_CHARS)
    voice: str = Field(max_length=64)
    response_format: str = "pcm"
    speed: float | None = Field(default=None, ge=0.5, le=2.0)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=5.0))
    yield
    await app.state.http.aclose()


app = FastAPI(
    title="MLX inference broker",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


@app.get("/health")
async def health(_: None = Depends(authenticate)) -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: Annotated[UploadFile, File()],
    _: None = Depends(authenticate),
) -> dict[str, str]:
    content = await file.read(MAX_AUDIO_BYTES + 1)
    if len(content) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="audio payload too large")
    audio = _decode_wav(content)
    async with _inference_slot:
        result = cast(
            dict[str, Any],
            await asyncio.to_thread(
            mlx_whisper.transcribe,
            audio,
            path_or_hf_repo=os.environ["MLX_STT_MODEL"],
            temperature=0.0,
            language=os.getenv("STT_LANGUAGE", "en"),
            ),
        )
    text = " ".join(
        str(segment.get("text", "")).strip()
        for segment in result.get("segments", [])
        if segment.get("no_speech_prob", 0.0) < 0.6
        and segment.get("compression_ratio") != 0.5555555555555556
    ).strip()
    return {"text": text}


@app.post("/v1/audio/speech")
async def speech(body: SpeechRequest, _: None = Depends(authenticate)) -> Response:
    if body.response_format != "pcm":
        raise HTTPException(status_code=400, detail="only PCM output is supported")
    async with _inference_slot:
        pcm, sample_rate = await asyncio.to_thread(
            synthesize_pcm,
            text=body.input,
            model_name=os.environ["MLX_TTS_MODEL"],
            voice=os.environ["MLX_TTS_VOICE"],
            speed=body.speed or float(os.getenv("MLX_TTS_SPEED", "1.0")),
            lang_code=os.getenv("MLX_TTS_LANGUAGE_CODE", "a"),
            streaming_interval=float(os.getenv("MLX_TTS_STREAMING_INTERVAL", "0.5")),
        )
    if sample_rate != 24000:
        logger.error("Refusing unexpected TTS sample rate: {}", sample_rate)
        raise HTTPException(status_code=502, detail="unexpected TTS sample rate")
    return Response(content=pcm, media_type="application/octet-stream")


def _validate_chat(payload: dict[str, Any]) -> None:
    if payload.get("model") != OLLAMA_MODEL:
        raise HTTPException(status_code=400, detail="model selection is not permitted")
    messages = payload.get("messages")
    if not isinstance(messages, list) or len(messages) > 64:
        raise HTTPException(status_code=400, detail="invalid message list")
    # OpenAI-compatible clients use both `system` and newer `developer` roles.
    allowed_roles = {"system", "developer", "user", "assistant", "tool"}
    total_chars = 0
    for message in messages:
        if not isinstance(message, dict) or message.get("role") not in allowed_roles:
            raise HTTPException(status_code=400, detail="invalid message")
        content = message.get("content", "")
        total_chars += len(content) if isinstance(content, str) else len(str(content))
    if total_chars > 64_000:
        raise HTTPException(status_code=413, detail="conversation is too large")
    tools = payload.get("tools", [])
    if not isinstance(tools, list) or len(tools) > 4:
        raise HTTPException(status_code=400, detail="invalid tool list")
    allowed_tools = {
        "propose_agent_task",
        "approve_agent_task",
        "get_agent_task",
        "cancel_agent_task",
    }
    for tool in tools:
        if not isinstance(tool, dict) or tool.get("type") != "function":
            raise HTTPException(status_code=400, detail="invalid tool declaration")
        function = tool.get("function")
        if not isinstance(function, dict) or function.get("name") not in allowed_tools:
            raise HTTPException(status_code=400, detail="unapproved tool declaration")


@app.post("/v1/chat/completions", response_model=None)
async def chat(request: Request, _: None = Depends(authenticate)) -> StreamingResponse | Response:
    body = await request.body()
    if len(body) > MAX_CHAT_BYTES:
        raise HTTPException(status_code=413, detail="chat payload too large")
    try:
        payload = json.loads(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid JSON") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid request")
    _validate_chat(payload)

    client: httpx.AsyncClient = request.app.state.http
    upstream = client.build_request(
        "POST",
        f"{OLLAMA_BASE_URL}/chat/completions",
        json=payload,
        headers={"Authorization": "Bearer ollama"},
    )
    response = await client.send(upstream, stream=True)
    if response.status_code != 200:
        content = await response.aread()
        await response.aclose()
        return Response(content=content[:8192], status_code=response.status_code)

    async def chunks():
        try:
            async for chunk in response.aiter_bytes():
                yield chunk
        finally:
            await response.aclose()

    return StreamingResponse(chunks(), media_type=response.headers.get("content-type"))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=9443, access_log=False)
