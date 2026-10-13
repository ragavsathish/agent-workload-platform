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
import time
import uuid
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

from voice_agent.shared.telemetry import configure_telemetry
from voice_agent.speech.application.transcription import extract_transcript
from voice_agent.speech.infrastructure.mlx_tts import synthesize_pcm

# The broker handles raw voice data. Do not emit library or application logs from this process.
logger.remove()

load_dotenv(os.getenv("INFERENCE_BROKER_ENV_FILE", ".env"), override=True)
telemetry = configure_telemetry("pipecat-mlx-inference")

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
    with telemetry.observe("inference.stt"):
        content = await file.read(MAX_AUDIO_BYTES + 1)
        if len(content) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="audio payload too large")
        audio = _decode_wav(content)
        telemetry.record("inference.stt.audio", outcome="accepted")
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
        transcript = extract_transcript(result)
        telemetry.record("inference.stt.transcript", outcome=transcript.outcome)
        if transcript.filtered_segments:
            telemetry.record(
                "inference.stt.segment",
                outcome="filtered",
                count=transcript.filtered_segments,
            )
        return {"text": transcript.text}


@app.post("/v1/audio/speech")
async def speech(body: SpeechRequest, _: None = Depends(authenticate)) -> Response:
    with telemetry.observe("inference.tts"):
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
    with telemetry.observe("inference.llm"):
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


def _pi_service_url() -> str:
    identities = [
        value.strip().lower()
        for value in os.getenv("ORCHESTRATOR_ALLOWED_USERS", "").split(",")
        if value.strip()
    ]
    if len(identities) != 1:
        raise HTTPException(status_code=503, detail="Pi voice requires exactly one allowed identity")
    gateway_token = os.getenv("AGENT_GATEWAY_TOKEN", "")
    if len(gateway_token) < 32:
        raise HTTPException(status_code=503, detail="Pi voice is not configured")
    return os.getenv("PI_VOICE_SERVICE_URL", "http://127.0.0.1:9446").rstrip("/")


def _openai_completion(text: str, *, model: str, completion_id: str, created: int) -> dict:
    return {
        "id": completion_id,
        "object": "chat.completion",
        "created": created,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


def _validate_pi_messages(messages: object) -> list[dict[str, Any]]:
    if not isinstance(messages, list) or not messages or len(messages) > 64:
        raise HTTPException(status_code=400, detail="invalid message list")
    validated: list[dict[str, Any]] = []
    total_chars = 0
    for message in messages:
        if not isinstance(message, dict) or message.get("role") not in {
            "system",
            "developer",
            "user",
            "assistant",
        }:
            raise HTTPException(status_code=400, detail="invalid Pi message")
        content = message.get("content", "")
        total_chars += len(content) if isinstance(content, str) else len(str(content))
        validated.append(message)
    if total_chars > 64_000:
        raise HTTPException(status_code=413, detail="conversation is too large")
    return validated


@app.post("/v1/pi/chat/completions", response_model=None)
async def pi_chat(request: Request, _: None = Depends(authenticate)) -> StreamingResponse | Response:
    """Run one voice turn through native Pi with only task-lifecycle tools enabled."""

    with telemetry.observe("inference.pi"):
        body = await request.body()
        if len(body) > MAX_CHAT_BYTES:
            raise HTTPException(status_code=413, detail="chat payload too large")
        try:
            payload = json.loads(body)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid JSON") from exc
        if not isinstance(payload, dict) or payload.get("model") != "pi-agent":
            raise HTTPException(status_code=400, detail="invalid Pi chat request")
        messages = _validate_pi_messages(payload.get("messages"))
        if payload.get("tools"):
            raise HTTPException(status_code=400, detail="external tools are not accepted by Pi voice")
        client: httpx.AsyncClient = request.app.state.http
        completion_id = f"chatcmpl-pi-{uuid.uuid4().hex}"
        created = int(time.time())

        if payload.get("stream", False):
            async def chunks():
                try:
                    async with client.stream(
                        "POST",
                        f"{_pi_service_url()}/v1/turn/stream",
                        json={"messages": messages},
                        headers={"Authorization": f"Bearer {BROKER_TOKEN}"},
                        timeout=float(os.getenv("PI_VOICE_TIMEOUT_SECONDS", "120")) + 5,
                    ) as response:
                        if response.status_code != 200:
                            yield f"data: {json.dumps({'error': {'message': 'Pi voice turn failed'}})}\n\n"
                            yield "data: [DONE]\n\n"
                            return
                        async for line in response.aiter_lines():
                            if not line.startswith("data: "):
                                continue
                            raw_event = line[6:]
                            try:
                                event = json.loads(raw_event)
                            except ValueError:
                                continue
                            if event.get("type") == "delta" and isinstance(event.get("delta"), str):
                                chunk = {
                                    "id": completion_id,
                                    "object": "chat.completion.chunk",
                                    "created": created,
                                    "model": "pi-agent",
                                    "choices": [{
                                        "index": 0,
                                        "delta": {"role": "assistant", "content": event["delta"]},
                                        "finish_reason": None,
                                    }],
                                }
                                yield f"data: {json.dumps(chunk)}\n\n"
                            elif event.get("type") == "error":
                                error_chunk = {"error": {"message": str(event.get("detail", "Pi voice turn failed"))}}
                                yield f"data: {json.dumps(error_chunk)}\n\n"
                                break
                except (TimeoutError, httpx.HTTPError) as exc:
                    error_chunk = {"error": {"message": "Pi voice service is unavailable"}}
                    logger.debug("Pi streaming request failed: {}", exc)
                    yield f"data: {json.dumps(error_chunk)}\n\n"
                last = {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": "pi-agent",
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                }
                yield f"data: {json.dumps(last)}\n\n"
                yield "data: [DONE]\n\n"

            return StreamingResponse(
                chunks(),
                media_type="text/event-stream",
                headers={"cache-control": "no-cache, no-transform", "x-accel-buffering": "no"},
            )

        try:
            async with asyncio.timeout(float(os.getenv("PI_VOICE_TIMEOUT_SECONDS", "120")) + 5):
                response = await client.post(
                    f"{_pi_service_url()}/v1/turn",
                    json={"messages": messages},
                    headers={"Authorization": f"Bearer {BROKER_TOKEN}"},
                )
        except (TimeoutError, httpx.HTTPError) as exc:
            raise HTTPException(status_code=502, detail="Pi voice service is unavailable") from exc
        if response.status_code != 200:
            raise HTTPException(status_code=502, detail="Pi voice turn failed")
        try:
            service_payload = response.json()
            text = service_payload["text"]
        except (ValueError, KeyError, TypeError) as exc:
            raise HTTPException(status_code=502, detail="Pi voice returned an invalid response") from exc
        if not isinstance(text, str) or not text.strip():
            raise HTTPException(status_code=502, detail="Pi voice returned an empty response")

        return Response(
            content=json.dumps(
                _openai_completion(
                    text, model="pi-agent", completion_id=completion_id, created=created
                )
            ),
            media_type="application/json",
        )


@app.get("/v1/pi/transcript", response_model=None)
async def pi_transcript(request: Request, _: None = Depends(authenticate)) -> Response:
    """Return Pi's bounded, display-safe transcript projection."""

    client: httpx.AsyncClient = request.app.state.http
    try:
        response = await client.get(
            f"{_pi_service_url()}/v1/transcript",
            headers={"Authorization": f"Bearer {BROKER_TOKEN}"},
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Pi transcript is unavailable") from exc
    if response.status_code != 200 or len(response.content) > 1_000_000:
        raise HTTPException(status_code=502, detail="Pi transcript is unavailable")
    return Response(
        content=response.content,
        media_type="application/json",
        headers={"Cache-Control": "no-store"},
    )


async def _pi_context_request(client: httpx.AsyncClient, method: str, path: str) -> Response:
    try:
        response = await client.request(
            method,
            f"{_pi_service_url()}{path}",
            headers={"Authorization": f"Bearer {BROKER_TOKEN}"},
            timeout=float(os.getenv("PI_VOICE_TIMEOUT_SECONDS", "120")) + 5,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Pi context is unavailable") from exc
    if response.status_code not in {200, 409} or len(response.content) > 16_384:
        raise HTTPException(status_code=502, detail="Pi context is unavailable")
    return Response(
        content=response.content,
        status_code=response.status_code,
        media_type="application/json",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/v1/pi/context", response_model=None)
async def pi_context(request: Request, _: None = Depends(authenticate)) -> Response:
    """Return bounded Pi context-window usage without transcript content."""

    return await _pi_context_request(request.app.state.http, "GET", "/v1/context")


@app.post("/v1/pi/context/compact", response_model=None)
async def compact_pi_context(request: Request, _: None = Depends(authenticate)) -> Response:
    """Compact the persistent voice session after any active turn completes."""

    return await _pi_context_request(request.app.state.http, "POST", "/v1/context/compact")


if __name__ == "__main__":
    import uvicorn

    # Keep the host broker on the standard loop for predictable MLX and child-process behavior.
    uvicorn.run(app, host="127.0.0.1", port=9443, access_log=False, loop="asyncio")
