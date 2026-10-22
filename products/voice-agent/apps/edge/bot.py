"""Tailnet-facing Pipecat process for the isolated Linux VM."""

import asyncio
import os
import re
import wave
from functools import lru_cache
from io import BytesIO
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import HTTPException, Request
from loguru import logger
from opentelemetry.context import attach, detach
from opentelemetry.propagate import extract, inject
from pipecat.adapters.schemas.direct_function import DirectFunction
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMRunFrame,
    LLMTextFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.runner.types import (
    RunnerArguments,
    SmallWebRTCRunnerArguments,
)
from pipecat.services.llm_service import FunctionCallParams
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.openai.stt import OpenAISTTService
from pipecat.services.openai.tts import OpenAITTSService
from pipecat.transports.base_transport import BaseTransport, TransportParams
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.turns.user_stop import TurnAnalyzerUserTurnStopStrategy
from pipecat.turns.user_turn_strategies import UserTurnStrategies
from pipecat.workers.runner import WorkerRunner
from voice_agent.shared.telemetry import configure_telemetry

from audio_diagnostics import audio_diagnostic_store
from audio_filter import audio_filter_readiness, create_audio_filter
from grafana_mcp import read_grafana_app, read_grafana_trace
from otel_bridge import configure_pipecat_observers
from presentation_response import StreamingSpokenExtractor, parse_presentation_response

# Voice content must never reach stdout/stderr. Docker also uses the `none` log driver, but removing
# Loguru's shared handler prevents Pipecat from formatting transcripts or LLM context at all.
logger.remove()

load_dotenv(override=True)
telemetry = configure_telemetry("pipecat-voice-edge")

class VoicePresentationResponseProcessor(FrameProcessor):
    """Split one model response into an MCP App presentation and TTS-safe speech."""

    def __init__(self):
        super().__init__()
        self._buffering = False
        self._chunks: list[str] = []
        self._spoken_extractor = StreamingSpokenExtractor()
        self._streamed_spoken = False

    async def process_frame(self, frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if direction != FrameDirection.DOWNSTREAM:
            await self.push_frame(frame, direction)
            return

        if isinstance(frame, LLMFullResponseStartFrame):
            self._buffering = True
            self._chunks = []
            self._spoken_extractor = StreamingSpokenExtractor()
            self._streamed_spoken = False
            await self.push_frame(frame)
            return

        if self._buffering and isinstance(frame, LLMTextFrame):
            self._chunks.append(frame.text)
            spoken_delta = self._spoken_extractor.feed(frame.text)
            if spoken_delta:
                self._streamed_spoken = True
                await self.push_frame(LLMTextFrame(spoken_delta))
            return

        if self._buffering and isinstance(frame, LLMFullResponseEndFrame):
            raw = "".join(self._chunks)
            self._buffering = False
            self._chunks = []
            if not raw.strip():
                await self.push_frame(frame)
                return

            response = parse_presentation_response(raw)
            await self.pipeline_worker.rtvi.send_server_message(
                {
                    "type": "mcp-app",
                    "resourceUri": response.resource_uri,
                    "presentation": response.presentation,
                    "spoken": response.spoken,
                }
            )
            if not self._streamed_spoken:
                await self.push_frame(LLMTextFrame(response.spoken))
            await self.push_frame(frame)
            return

        await self.push_frame(frame, direction)


def required_env(name: str) -> str:
    value = os.getenv(name)
    file_name = os.getenv(f"{name}_FILE")
    if not value and file_name:
        value = Path(file_name).read_text(encoding="utf-8").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def allowed_identities() -> set[str]:
    return {
        value.strip().lower()
        for value in required_env("EDGE_ALLOWED_USERS").split(",")
        if value.strip()
    }


def resolve_webrtc_identity() -> str:
    """Resolve the identity after the HTTP signaling middleware authenticates it.

    Pipecat's SmallWebRTC runner arguments do not carry the signaling request headers.
    Fail closed unless this edge is configured for exactly one user, avoiding an
    untrusted identity supplied by the browser in request data.
    """
    allowed = allowed_identities()
    if len(allowed) != 1:
        raise PermissionError("SmallWebRTC requires exactly one configured edge user")
    return next(iter(allowed))


def validate_identity(identity: str) -> str:
    allowed = allowed_identities()
    if not identity:
        raise PermissionError("connect through the configured Tailscale ingress")
    if identity not in allowed:
        raise PermissionError("tailnet identity is not allowed")
    return identity


def local_ingress_identity(request: Request) -> str | None:
    """Resolve the single configured owner for loopback-only local ingress.

    Traefik adds the marker only on its dedicated local entry point, which Docker
    publishes on host loopback. The tailnet routers remove any client-supplied
    copy before proxying, so the marker cannot bypass tailnet authentication.
    """
    enabled = os.getenv("EDGE_ALLOW_LOCAL_INGRESS", "").strip().lower()
    marker = request.headers.get("x-voice-local-ingress", "").strip()
    if enabled not in {"1", "true", "yes"} or marker != "1":
        return None
    allowed = allowed_identities()
    if len(allowed) != 1:
        raise PermissionError("local ingress requires exactly one configured edge user")
    return next(iter(allowed))


def validate_http_identity(request: Request) -> str:
    try:
        allowed_origins = {
            value.strip()
            for value in required_env("PIPECAT_ALLOWED_ORIGINS").split(",")
            if value.strip()
        }
        if os.getenv("EDGE_ALLOW_LOCAL_INGRESS", "").strip().lower() in {
            "1",
            "true",
            "yes",
        }:
            allowed_origins.update(
                value.strip()
                for value in os.getenv(
                    "EDGE_LOCAL_ORIGINS",
                    "http://127.0.0.1:8080,http://localhost:8080",
                ).split(",")
                if value.strip()
            )
        origin = request.headers.get("origin", "")
        safe_method = request.method.upper() in {"GET", "HEAD", "OPTIONS"}
        # Browsers commonly omit Origin on same-origin GET/HEAD requests. Keep
        # explicit foreign origins out, and require an allowed origin for every
        # state-changing request. Tailnet identity is required in both cases.
        if (origin and origin not in allowed_origins) or (not safe_method and not origin):
            raise PermissionError("browser origin is not allowed")
        local_identity = local_ingress_identity(request)
        if local_identity is not None:
            return local_identity
        return validate_identity(request.headers.get("tailscale-user-login", "").strip().lower())
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


def validate_ingress_identity(request: Request) -> str:
    """Authorize Traefik's owner-only forward-auth request."""
    try:
        return validate_identity(request.headers.get("tailscale-user-login", "").strip().lower())
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


async def broker_transcript_request() -> dict[str, object]:
    headers = {"Authorization": f"Bearer {required_env('INFERENCE_BROKER_TOKEN')}"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
        response = await client.get(
            f"{required_env('INFERENCE_BROKER_BASE_URL').rstrip('/')}/pi/transcript",
            headers=headers,
        )
    if response.is_error:
        raise HTTPException(status_code=502, detail="Pi transcript is unavailable")
    payload = response.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="invalid Pi transcript")
    return payload


def playwright_trace_upstream(path: str) -> str:
    """Resolve a narrowly scoped Trace Viewer request to the host-side MCP service."""

    if (
        not path
        or len(path) > 512
        or "\\" in path
        or any(segment in {"", ".", ".."} for segment in path.split("/"))
    ):
        raise HTTPException(status_code=400, detail="invalid Playwright trace path")
    base_url = required_env("PLAYWRIGHT_TRACE_VIEWER_INTERNAL_BASE_URL").rstrip("/")
    return f"{base_url}/{path}"


async def proxy_playwright_trace(request: Request, upstream_path: str):
    """Stream immutable viewer assets or a selected trace through the owner-only edge."""

    from starlette.background import BackgroundTask
    from starlette.responses import StreamingResponse

    validate_http_identity(request)
    client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=5.0))
    forwarded_headers = {
        name: value
        for name in ("range", "if-none-match", "if-modified-since")
        if (value := request.headers.get(name)) is not None
    }
    try:
        upstream = await client.send(
            client.build_request(
                "GET",
                playwright_trace_upstream(upstream_path),
                headers=forwarded_headers,
            ),
            stream=True,
        )
    except httpx.HTTPError as exc:
        await client.aclose()
        raise HTTPException(
            status_code=502, detail="Playwright Trace Viewer is unavailable"
        ) from exc

    async def close_upstream() -> None:
        await upstream.aclose()
        await client.aclose()

    response_headers = {
        name: value
        for name in (
            "accept-ranges",
            "cache-control",
            "content-length",
            "content-range",
            "content-type",
            "etag",
            "last-modified",
        )
        if (value := upstream.headers.get(name)) is not None
    }
    response_headers["X-Content-Type-Options"] = "nosniff"
    return StreamingResponse(
        upstream.aiter_raw(),
        status_code=upstream.status_code,
        headers=response_headers,
        background=BackgroundTask(close_upstream),
    )


async def broker_sessions_request(
    path: str = "",
    method: str = "GET",
    *,
    operation: str,
) -> dict[str, object]:
    with telemetry.observe(operation):
        headers = {"Authorization": f"Bearer {required_env('INFERENCE_BROKER_TOKEN')}"}
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
            response = await client.request(
                method,
                f"{required_env('INFERENCE_BROKER_BASE_URL').rstrip('/')}/pi/sessions{path}",
                headers=headers,
            )
        if response.is_error:
            status = response.status_code if response.status_code in {404, 409} else 502
            detail = "Pi session history is unavailable"
            try:
                service_detail = response.json().get("detail")
                if isinstance(service_detail, str):
                    detail = service_detail
            except ValueError:
                pass
            raise HTTPException(status_code=status, detail=detail)
        payload = response.json()
        if not isinstance(payload, dict):
            raise HTTPException(status_code=502, detail="invalid Pi session history")
        return payload


@lru_cache(maxsize=1)
def voice_prompt_template() -> str:
    """Load the stable system prompt shared by voice and typed turns."""
    prompt = Path(__file__).with_name("SYSTEM.md").read_text(encoding="utf-8").strip()
    if not prompt:
        raise RuntimeError("SYSTEM.md must not be empty")
    marker = "{{DEFAULT_WORKSPACE}}"
    if prompt.count(marker) != 1:
        raise RuntimeError("SYSTEM.md must define one default-workspace placeholder")
    return prompt


def voice_system_instruction(default_workspace: str) -> str:
    """Render the one stable Pi instruction shared by voice and typed turns."""
    workspace = default_workspace.strip()
    if not workspace or len(workspace) > 256 or any(char in workspace for char in "\r\n"):
        raise RuntimeError("VOICE_DEFAULT_WORKSPACE is invalid")
    return voice_prompt_template().replace("{{DEFAULT_WORKSPACE}}", workspace)


async def broker_pi_message(message: str):
    """Send one typed turn through the same persistent Pi session as voice."""
    timeout = float(os.getenv("PI_VOICE_TIMEOUT_SECONDS", "120")) + 10
    headers = {"Authorization": f"Bearer {required_env('INFERENCE_BROKER_TOKEN')}"}
    payload = {
        "model": "pi-agent",
        "stream": False,
        "messages": [
            {
                "role": "system",
                "content": voice_system_instruction(required_env("VOICE_DEFAULT_WORKSPACE")),
            },
            {"role": "user", "content": message},
        ],
    }
    with telemetry.observe("browser.pi.turn"):
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=5.0)) as client:
            response = await client.post(
                f"{required_env('INFERENCE_BROKER_BASE_URL').rstrip('/')}/pi/chat/completions",
                headers=headers,
                json=payload,
            )
    if response.is_error:
        raise HTTPException(status_code=502, detail="Pi response is unavailable")
    try:
        raw = response.json()["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Pi returned an invalid response") from exc
    if not isinstance(raw, str) or not raw.strip():
        raise HTTPException(status_code=502, detail="Pi returned an empty response")
    return parse_presentation_response(raw)


async def broker_context_request(method: str, path: str) -> dict[str, object]:
    headers = {"Authorization": f"Bearer {required_env('INFERENCE_BROKER_TOKEN')}"}
    timeout = float(os.getenv("PI_VOICE_TIMEOUT_SECONDS", "120")) + 10
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=5.0)) as client:
        response = await client.request(
            method,
            f"{required_env('INFERENCE_BROKER_BASE_URL').rstrip('/')}/pi/context{path}",
            headers=headers,
        )
    if response.is_error:
        detail = "Pi context is unavailable"
        try:
            service_detail = response.json().get("detail")
            if isinstance(service_detail, str):
                detail = service_detail
        except ValueError:
            pass
        raise HTTPException(status_code=response.status_code, detail=detail)
    payload = response.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="invalid Pi context")
    return payload


async def broker_abort_pi_turn() -> dict[str, object]:
    headers = {"Authorization": f"Bearer {required_env('INFERENCE_BROKER_TOKEN')}"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
        response = await client.post(
            f"{required_env('INFERENCE_BROKER_BASE_URL').rstrip('/')}/pi/turn/abort",
            headers=headers,
        )
    if response.is_error:
        raise HTTPException(status_code=502, detail="Pi turn could not be stopped")
    payload = response.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="invalid Pi turn response")
    return payload


async def broker_detach_pi_task() -> None:
    headers = {"Authorization": f"Bearer {required_env('INFERENCE_BROKER_TOKEN')}"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
        response = await client.post(
            f"{required_env('INFERENCE_BROKER_BASE_URL').rstrip('/')}/pi/tasks/detach",
            headers=headers,
        )
    if response.is_error:
        raise RuntimeError("Pi task could not be detached")


async def owner_gateway_request(
    request: Request,
    method: str,
    path: str,
    *,
    body: dict[str, object] | None = None,
    query: dict[str, str | int] | None = None,
) -> object:
    """Proxy one owner-scoped task operation through the narrow gateway."""
    identity = validate_http_identity(request)
    headers = {"Authorization": f"Bearer {required_env('AGENT_GATEWAY_TOKEN')}"}
    url = f"{required_env('AGENT_GATEWAY_BASE_URL').rstrip('/')}{path}"
    with telemetry.observe("task.gateway"):
        inject(headers)
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0)) as client:
            if method == "GET":
                response = await client.request(
                    method,
                    url,
                    headers=headers,
                    params={"identity": identity, **(query or {})},
                )
            else:
                response = await client.request(
                    method, url, headers=headers, json={"identity": identity, **(body or {})}
                )
    if response.is_error:
        try:
            detail = response.json().get("detail", "task request failed")
        except (ValueError, AttributeError):
            detail = "task request failed"
        raise HTTPException(status_code=response.status_code, detail=str(detail))
    return response.json()


async def owner_gateway_audio(request: Request, generation_id: str) -> bytes:
    """Retrieve one completed song without exposing the gateway bearer to the browser."""
    if re.fullmatch(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
        generation_id,
    ) is None:
        raise HTTPException(status_code=400, detail="invalid song generation ID")
    identity = validate_http_identity(request)
    headers = {"Authorization": f"Bearer {required_env('AGENT_GATEWAY_TOKEN')}"}
    url = (
        f"{required_env('AGENT_GATEWAY_BASE_URL').rstrip('/')}"
        f"/music/generations/{generation_id}/audio"
    )
    with telemetry.observe("song.audio.proxy"):
        inject(headers)
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0)) as client:
            response = await client.get(url, headers=headers, params={"identity": identity})
    if response.is_error:
        raise HTTPException(status_code=response.status_code, detail="song audio is unavailable")
    if response.headers.get("content-type", "").split(";", 1)[0] != "audio/mp4":
        raise HTTPException(status_code=502, detail="gateway returned invalid song audio")
    if not response.content or len(response.content) > 32 * 1024 * 1024:
        raise HTTPException(status_code=502, detail="gateway returned invalid song audio")
    return response.content


async def owner_gateway_artifact(
    request: Request, proposal_id: str, name: str
) -> tuple[bytes, str, str]:
    """Proxy an owner-scoped task download without exposing the gateway bearer."""
    if name not in {"workspace", "patch"} or re.fullmatch(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", proposal_id
    ) is None:
        raise HTTPException(status_code=404, detail="task artifact is unavailable")
    identity = validate_http_identity(request)
    headers = {"Authorization": f"Bearer {required_env('AGENT_GATEWAY_TOKEN')}"}
    url = (
        f"{required_env('AGENT_GATEWAY_BASE_URL').rstrip('/')}/tasks/"
        f"{proposal_id}/artifacts/{name}"
    )
    with telemetry.observe("task.artifact.proxy"):
        inject(headers)
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0)) as client:
            response = await client.get(url, headers=headers, params={"identity": identity})
    if response.is_error:
        raise HTTPException(status_code=response.status_code, detail="task artifact is unavailable")
    if len(response.content) > 16_777_216:
        raise HTTPException(status_code=502, detail="task artifact is too large")
    return (
        response.content,
        response.headers.get("content-type", "application/octet-stream"),
        response.headers.get("content-disposition", "attachment"),
    )


def task_spoken_text(view: object) -> str:
    if not isinstance(view, dict):
        raise HTTPException(status_code=502, detail="invalid task response")
    snapshot = view.get("result")
    execution = snapshot.get("result") if isinstance(snapshot, dict) else None
    response = execution.get("response") if isinstance(execution, dict) else None
    spoken = response.get("spoken") if isinstance(response, dict) else None
    if not isinstance(spoken, str) or not spoken.strip():
        raise HTTPException(status_code=409, detail="task response is not ready")
    return spoken.strip()[:2_000]


def pcm_wave(pcm: bytes) -> bytes:
    output = BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(24_000)
        target.writeframes(pcm)
    return output.getvalue()


async def broker_speech(spoken: str) -> bytes:
    """Synthesize bounded speech and return a browser-playable WAV."""
    headers = {"Authorization": f"Bearer {required_env('INFERENCE_BROKER_TOKEN')}"}
    with telemetry.observe("browser.pi.speech"):
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=5.0)) as client:
            response = await client.post(
                f"{required_env('INFERENCE_BROKER_BASE_URL').rstrip('/')}/audio/speech",
                headers=headers,
                json={
                    "model": "kokoro",
                    "input": spoken,
                    "voice": "alloy",
                    "response_format": "pcm",
                    "speed": 1.0,
                },
            )
    if response.is_error or len(response.content) > 50_000_000:
        raise HTTPException(status_code=502, detail="Pi speech is unavailable")
    return pcm_wave(response.content)


async def run_bot(transport: BaseTransport, identity: str):
    broker_url = required_env("INFERENCE_BROKER_BASE_URL")
    broker_token = required_env("INFERENCE_BROKER_TOKEN")
    gateway_url = required_env("AGENT_GATEWAY_BASE_URL").rstrip("/")
    gateway_token = required_env("AGENT_GATEWAY_TOKEN")
    llm_backend = os.getenv("VOICE_LLM_BACKEND", "ollama").strip().lower()
    if llm_backend not in {"ollama", "pi"}:
        raise RuntimeError("VOICE_LLM_BACKEND must be either 'ollama' or 'pi'")
    model = "pi-agent" if llm_backend == "pi" else required_env("OLLAMA_MODEL")
    llm_base_url = f"{broker_url.rstrip('/')}/pi" if llm_backend == "pi" else broker_url
    default_workspace = required_env("VOICE_DEFAULT_WORKSPACE")

    stt = OpenAISTTService(
        api_key=broker_token,
        base_url=broker_url,
        settings=OpenAISTTService.Settings(model="parakeet-v3", language="en"),
    )
    llm = OpenAILLMService(
        api_key=broker_token,
        base_url=llm_base_url,
        settings=OpenAILLMService.Settings(
            model=model,
            system_instruction=voice_system_instruction(default_workspace),
        ),
    )
    tts = OpenAITTSService(
        api_key=broker_token,
        base_url=broker_url,
        settings=OpenAITTSService.Settings(model="kokoro", voice="alloy", speed=1.0),
    )

    http_client = httpx.AsyncClient(
        base_url=gateway_url,
        headers={"Authorization": f"Bearer {gateway_token}"},
        timeout=httpx.Timeout(30.0, connect=5.0),
    )

    async def gateway_request(method: str, path: str, **kwargs) -> dict[str, object]:
        operation = f"gateway.{method.lower()}"
        with telemetry.observe(operation):
            request_headers = dict(kwargs.pop("headers", {}))
            inject(request_headers)
            response = await http_client.request(
                method, path, headers=request_headers, **kwargs
            )
            if response.is_error:
                try:
                    detail = response.json().get("detail", "request failed")
                except ValueError:
                    detail = "request failed"
                raise RuntimeError(f"agent gateway rejected the request: {detail}")
            payload = response.json()
            if not isinstance(payload, dict):
                raise RuntimeError("agent gateway returned an invalid response")
            return payload

    async def gateway_list_request(path: str, **kwargs) -> list[dict[str, object]]:
        with telemetry.observe("gateway.get"):
            request_headers = dict(kwargs.pop("headers", {}))
            inject(request_headers)
            response = await http_client.get(path, headers=request_headers, **kwargs)
            if response.is_error:
                try:
                    detail = response.json().get("detail", "request failed")
                except ValueError:
                    detail = "request failed"
                raise RuntimeError(f"agent gateway rejected the request: {detail}")
            payload = response.json()
            if not isinstance(payload, list) or not all(isinstance(item, dict) for item in payload):
                raise RuntimeError("agent gateway returned an invalid task list")
            return payload

    async def propose_agent_task(params: FunctionCallParams) -> None:
        try:
            result = await gateway_request(
                "POST",
                "/tasks",
                json={
                    "identity": identity,
                    "instruction": str(params.arguments["instruction"]),
                    "workspace": str(params.arguments["workspace"]),
                },
            )
            await params.result_callback(result)
        except Exception as exc:
            logger.exception("Unable to propose agent task")
            await params.result_callback({"error": str(exc)})

    async def get_agent_task(params: FunctionCallParams) -> None:
        try:
            proposal_id = str(params.arguments["proposal_id"])
            result = await gateway_request(
                "GET", f"/tasks/{proposal_id}", params={"identity": identity}
            )
            await params.result_callback(result)
        except Exception as exc:
            logger.exception("Unable to inspect agent task")
            await params.result_callback({"error": str(exc)})

    async def find_agent_task(params: FunctionCallParams) -> None:
        try:
            session_name = str(params.arguments["session_name"]).strip()
            matches = await gateway_list_request(
                "/tasks",
                params={"identity": identity, "session_name": session_name, "limit": 2},
            )
            if not matches:
                raise RuntimeError(f"No task named {session_name!r}")
            if len(matches) != 1:
                raise RuntimeError(f"Task name {session_name!r} is not unique")
            await params.result_callback(matches[0])
        except Exception as exc:
            logger.exception("Unable to find agent task by session name")
            await params.result_callback({"error": str(exc)})

    async def submit_agent_task(params: FunctionCallParams) -> None:
        try:
            proposal = await gateway_request(
                "POST",
                "/tasks",
                json={
                    "identity": identity,
                    "instruction": str(params.arguments["instruction"]),
                    "workspace": str(params.arguments["workspace"]),
                },
            )
            proposal_id = proposal.get("id")
            if not isinstance(proposal_id, str) or not proposal_id:
                raise RuntimeError("agent gateway created a proposal without an ID")
            result = await gateway_request(
                "POST",
                f"/tasks/{proposal_id}/approve",
                json={"identity": identity},
            )
            await params.result_callback(result)
        except Exception as exc:
            logger.exception("Unable to submit agent task")
            await params.result_callback({"error": str(exc)})

    async def approve_agent_task(params: FunctionCallParams) -> None:
        try:
            proposal_id = str(params.arguments["proposal_id"])
            result = await gateway_request(
                "POST",
                f"/tasks/{proposal_id}/approve",
                json={"identity": identity},
            )
            await params.result_callback(result)
        except Exception as exc:
            logger.exception("Unable to approve agent task")
            await params.result_callback({"error": str(exc)})

    async def cancel_agent_task(params: FunctionCallParams) -> None:
        try:
            proposal_id = str(params.arguments["proposal_id"])
            result = await gateway_request(
                "POST",
                f"/tasks/{proposal_id}/cancel",
                json={"identity": identity},
            )
            await params.result_callback(result)
        except Exception as exc:
            logger.exception("Unable to cancel agent task")
            await params.result_callback({"error": str(exc)})

    proposal_id_property = {
        "type": "string",
        "description": "The exact proposal ID returned by propose_agent_task.",
    }
    gateway_tools: list[FunctionSchema | DirectFunction] = [
        FunctionSchema(
            name="propose_agent_task",
            description="Create a pending Pi task proposal. This does not start work.",
            properties={
                "instruction": {
                    "type": "string",
                    "description": "The complete and specific instruction for Pi.",
                },
                "workspace": {
                    "type": "string",
                    "description": "Allowlisted project name, or 'scratch' when no repository is selected. A missing named project never falls back automatically.",
                },
            },
            required=["instruction", "workspace"],
            handler=propose_agent_task,
        ),
        FunctionSchema(
            name="get_agent_task",
            description="Read the status and bounded result of one owned Pi task proposal.",
            properties={"proposal_id": proposal_id_property},
            required=["proposal_id"],
            handler=get_agent_task,
        ),
        FunctionSchema(
            name="find_agent_task",
            description="Find one owned Pi task by its exact displayed jazz session name.",
            properties={
                "session_name": {
                    "type": "string",
                    "description": "Exact session name, including the Take number when shown.",
                }
            },
            required=["session_name"],
            handler=find_agent_task,
        ),
        FunctionSchema(
            name="submit_agent_task",
            description=(
                "Create and immediately approve durable project work for another Pi worker."
            ),
            properties={
                "instruction": {
                    "type": "string",
                    "description": "The complete and specific instruction for Pi.",
                },
                "workspace": {
                    "type": "string",
                    "description": "Allowlisted project name, or 'scratch' when no repository is selected. A missing named project never falls back automatically.",
                },
            },
            required=["instruction", "workspace"],
            handler=submit_agent_task,
        ),
        FunctionSchema(
            name="approve_agent_task",
            description=(
                "Approve one pending proposal only after the user explicitly asks to approve "
                "that task in a later turn."
            ),
            properties={"proposal_id": proposal_id_property},
            required=["proposal_id"],
            handler=approve_agent_task,
        ),
        FunctionSchema(
            name="cancel_agent_task",
            description="Cancel one pending or running task owned by this tailnet identity.",
            properties={"proposal_id": proposal_id_property},
            required=["proposal_id"],
            handler=cancel_agent_task,
        ),
    ]
    # In Pi mode the native Pi process owns the task tools through its
    # restricted extension. Ollama mode keeps executing them in this edge.
    context = LLMContext(tools=[] if llm_backend == "pi" else gateway_tools)
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=0.2)),
            user_turn_strategies=UserTurnStrategies(
                stop=[
                    TurnAnalyzerUserTurnStopStrategy(
                        turn_analyzer=LocalSmartTurnAnalyzerV3(),
                    )
                ]
            ),
            user_idle_timeout=90.0,
        ),
    )

    @user_aggregator.event_handler("on_user_turn_started")
    async def on_user_turn_started(_aggregator, _strategy):
        telemetry.record("pipecat.user_turn.started")

    @user_aggregator.event_handler("on_user_turn_inference_triggered")
    async def on_user_turn_inference_triggered(_aggregator, _strategy):
        telemetry.record("pipecat.user_turn.inference_triggered")

    @user_aggregator.event_handler("on_user_turn_stopped")
    async def on_user_turn_stopped(_aggregator, _strategy, _message):
        telemetry.record("pipecat.user_turn.stopped")

    @user_aggregator.event_handler("on_user_turn_stop_timeout")
    async def on_user_turn_stop_timeout(_aggregator):
        telemetry.record("pipecat.user_turn.stop_timeout", outcome="timeout")

    @user_aggregator.event_handler("on_user_turn_message_added")
    async def on_user_turn_message_added(_aggregator, _message):
        telemetry.record("pipecat.user_turn.transcript_emitted")

    presentation_response = VoicePresentationResponseProcessor()
    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            llm,
            presentation_response,
            tts,
            transport.output(),
            assistant_aggregator,
        ]
    )
    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=16000,
            audio_out_sample_rate=24000,
            enable_heartbeats=True,
            heartbeats_period_secs=5.0,
            heartbeats_monitor_secs=15.0,
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
        observers=list(configure_pipecat_observers(telemetry)),
    )

    @worker.rtvi.event_handler("on_client_ready")
    async def on_client_ready(rtvi):
        context.add_message(
            {
                "role": "developer",
                "content": (
                    f"The authenticated user is {identity}. Respond with spoken exactly "
                    '"Voice interface ready." and a flow presentation showing Voice connected '
                    "to Pi using the response schema from your system instruction."
                ),
            }
        )
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        try:
            await broker_detach_pi_task()
        except Exception:
            logger.exception("Unable to detach remote Pi task")
        await http_client.aclose()
        await worker.cancel()

    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)
    await runner.run()


_voice_session_active = False


async def bot(runner_args: RunnerArguments):
    global _voice_session_active
    with telemetry.observe("voice.session"):
        match runner_args:
            case SmallWebRTCRunnerArguments():
                try:
                    identity = resolve_webrtc_identity()
                except PermissionError as exc:
                    logger.warning("Rejected WebRTC edge connection: {}", exc)
                    await runner_args.webrtc_connection.disconnect()
                    return
                if _voice_session_active:
                    logger.warning("Rejected concurrent WebRTC voice session")
                    await runner_args.webrtc_connection.disconnect()
                    return
                transport = SmallWebRTCTransport(
                    webrtc_connection=runner_args.webrtc_connection,
                    params=TransportParams(
                        audio_in_enabled=True,
                        audio_in_filter=create_audio_filter(telemetry),
                        audio_out_enabled=True,
                    ),
                )
                # There is no await between the admission check and this
                # assignment, so asyncio tasks cannot interleave here. Set the
                # guard only after construction succeeds to avoid wedging the
                # service in a permanently-busy state on constructor failure.
                _voice_session_active = True
            case _:
                logger.error("Unsupported runner arguments: {}", type(runner_args))
                return
        try:
            await run_bot(transport, identity)
        finally:
            _voice_session_active = False


if __name__ == "__main__":
    from fastapi.responses import FileResponse, JSONResponse, Response
    from fastapi.staticfiles import StaticFiles
    from pipecat.runner.run import app, main

    @app.middleware("http")
    async def authenticate_signaling(request: Request, call_next):
        path = request.url.path
        if path == "/start" or path == "/api/offer" or path.startswith("/sessions/"):
            try:
                validate_http_identity(request)
            except HTTPException as exc:
                return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
        # Preserve an inbound W3C trace context across the browser turn and its
        # broker operation. The context contains identifiers, never payloads.
        token = attach(extract(request.headers))
        try:
            response = await call_next(request)
        finally:
            detach(token)
        if path.startswith(("/mermaid/", "/marp/", "/excalidraw/", "/journal-review/")):
            # The MCP App runs in an opaque-origin sandbox. Permit only its
            # immutable static assets to load across that sandbox boundary.
            response.headers["Access-Control-Allow-Origin"] = "*"
            response.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
        return response

    client_dist = Path(__file__).resolve().parent / "client-dist"
    if (client_dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=client_dist / "assets"), name="assets")
    if (client_dist / "canvaskit").is_dir():
        app.mount(
            "/canvaskit",
            StaticFiles(directory=client_dist / "canvaskit"),
            name="canvaskit",
        )
    if (client_dist / "voice-runtime").is_dir():
        app.mount(
            "/voice-runtime",
            StaticFiles(directory=client_dist / "voice-runtime"),
            name="voice-runtime",
        )
    if (client_dist / "mermaid").is_dir():
        app.mount(
            "/mermaid",
            StaticFiles(directory=client_dist / "mermaid", html=True),
            name="mermaid",
        )
    if (client_dist / "marp").is_dir():
        app.mount(
            "/marp",
            StaticFiles(directory=client_dist / "marp", html=True),
            name="marp",
        )
    if (client_dist / "trace-explainer").is_dir():
        app.mount(
            "/trace-explainer",
            StaticFiles(directory=client_dist / "trace-explainer", html=True),
            name="trace-explainer",
        )
    if (client_dist / "journal-review").is_dir():
        app.mount(
            "/journal-review",
            StaticFiles(directory=client_dist / "journal-review", html=True),
            name="journal-review",
        )
    if (client_dist / "excalidraw").is_dir():
        app.mount(
            "/excalidraw",
            StaticFiles(directory=client_dist / "excalidraw", html=True),
            name="excalidraw",
        )
    if (client_dist / "diagnostics").is_dir():
        app.mount(
            "/diagnostics",
            StaticFiles(directory=client_dist / "diagnostics", html=True),
            name="diagnostics",
        )

    def register_browser_asset(asset_name: str, media_type: str | None = None) -> None:
        """Expose one generated Flutter root asset without shadowing Pipecat routes."""

        async def browser_asset():
            target = client_dist / asset_name
            if not target.is_file():
                return JSONResponse({"error": "client build is missing"}, status_code=503)
            return FileResponse(target, media_type=media_type)

        app.add_api_route(
            f"/{asset_name}",
            browser_asset,
            methods=["GET"],
            include_in_schema=False,
            name=f"browser-{asset_name.replace('.', '-')}",
        )

    for browser_asset_name, browser_asset_type in (
        ("flutter_bootstrap.js", "text/javascript"),
        ("flutter.js", "text/javascript"),
        ("flutter_service_worker.js", "text/javascript"),
        ("favicon.svg", "image/svg+xml"),
        ("main.dart.js", "text/javascript"),
        ("main.dart.mjs", "text/javascript"),
        ("main.dart.wasm", "application/wasm"),
        ("manifest.json", "application/manifest+json"),
        ("version.json", "application/json"),
    ):
        register_browser_asset(browser_asset_name, browser_asset_type)

    @app.get("/", include_in_schema=False)
    async def browser_client():
        index = client_dist / "index.html"
        if not index.is_file():
            return JSONResponse({"error": "client build is missing"}, status_code=503)
        return FileResponse(index)

    @app.get("/api/features")
    async def features():
        return {
            "tasks": True,
            "piTranscript": True,
            "approval": "voice-yolo",
            "isolation": "docker-desktop-compose",
            "defaultWorkspace": required_env("VOICE_DEFAULT_WORKSPACE"),
            "audioFilter": audio_filter_readiness(),
        }

    @app.get("/api/grafana-mcp/apps/trace", include_in_schema=False)
    async def grafana_trace_app(request: Request):
        validate_http_identity(request)
        try:
            resource = await read_grafana_app(
                required_env("GRAFANA_MCP_URL"),
                required_env("GRAFANA_MCP_SERVER_TOKEN"),
                "ui://grafana/trace.html",
            )
            contents = resource.get("contents")
            item = contents[0] if isinstance(contents, list) and contents else None
            html = item.get("text") if isinstance(item, dict) else None
            if not isinstance(html, str) or not html:
                raise RuntimeError("Grafana MCP trace App resource is empty")
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail="Grafana trace App is unavailable") from exc
        return Response(
            content=html,
            media_type="text/html",
            headers={
                "Cache-Control": "private, max-age=3600",
                "Content-Security-Policy": (
                    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
                    "img-src data:; font-src data:"
                ),
            },
        )

    @app.get("/api/grafana-mcp/traces/{trace_id}", include_in_schema=False)
    async def grafana_trace_data(
        trace_id: str,
        request: Request,
        datasourceUid: str = "tempo",
        focusSpanId: str | None = None,
    ):
        validate_http_identity(request)
        if re.fullmatch(r"[0-9a-fA-F]{32}", trace_id) is None:
            raise HTTPException(status_code=400, detail="invalid Tempo trace ID")
        if re.fullmatch(r"[A-Za-z0-9_-]{1,80}", datasourceUid) is None:
            raise HTTPException(status_code=400, detail="invalid Tempo datasource UID")
        if focusSpanId is not None and re.fullmatch(r"[0-9a-fA-F]{16}", focusSpanId) is None:
            raise HTTPException(status_code=400, detail="invalid Tempo focus span ID")
        try:
            result = await read_grafana_trace(
                required_env("GRAFANA_MCP_URL"),
                required_env("GRAFANA_MCP_SERVER_TOKEN"),
                datasource_uid=datasourceUid,
                trace_id=trace_id.lower(),
                focus_span_id=focusSpanId.lower() if focusSpanId else None,
            )
            structured = result.get("structuredContent")
            if result.get("isError") or not isinstance(structured, dict):
                raise RuntimeError("Grafana MCP returned no trace App data")
            public_origin = next(
                (
                    value.strip().rstrip("/")
                    for value in required_env("PIPECAT_ALLOWED_ORIGINS").split(",")
                    if value.strip()
                ),
                None,
            )
            if public_origin:
                structured["grafanaUrl"] = f"{public_origin}/metrics/"
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail="Grafana trace is unavailable") from exc
        return JSONResponse(structured, headers={"Cache-Control": "no-store"})

    @app.get("/trace-viewer/{asset_path:path}", include_in_schema=False)
    async def playwright_trace_viewer_asset(asset_path: str, request: Request):
        return await proxy_playwright_trace(request, f"trace-viewer/{asset_path}")

    @app.get(
        "/api/playwright-traces/{trace_id}/trace.zip",
        include_in_schema=False,
    )
    async def playwright_trace_data(trace_id: str, request: Request):
        if re.fullmatch(r"[0-9a-f]{32}", trace_id) is None:
            raise HTTPException(status_code=400, detail="invalid Playwright trace ID")
        return await proxy_playwright_trace(
            request,
            f"api/playwright-traces/{trace_id}/trace.zip",
        )

    @app.get(
        "/api/playwright-traces/{trace_id}/preview",
        include_in_schema=False,
    )
    async def playwright_trace_preview(trace_id: str, request: Request):
        if re.fullmatch(r"[0-9a-f]{32}", trace_id) is None:
            raise HTTPException(status_code=400, detail="invalid Playwright trace ID")
        return await proxy_playwright_trace(
            request,
            f"api/playwright-traces/{trace_id}/preview",
        )

    @app.get(
        "/api/trace-explainers/{render_id}/video",
        include_in_schema=False,
    )
    async def playwright_trace_narrated_video(render_id: str, request: Request):
        if re.fullmatch(r"[0-9a-f]{32}", render_id) is None:
            raise HTTPException(status_code=400, detail="invalid trace explainer render ID")
        return await proxy_playwright_trace(
            request,
            f"api/trace-explainers/{render_id}/video",
        )

    @app.get("/api/ingress-auth", include_in_schema=False)
    async def ingress_auth(request: Request):
        validate_ingress_identity(request)
        return Response(status_code=204)

    @app.get("/api/tasks")
    async def list_browser_tasks(request: Request):
        query = {}
        if session_name := request.query_params.get("session_name"):
            query["session_name"] = session_name
        if limit := request.query_params.get("limit"):
            query["limit"] = limit
        return JSONResponse(
            await owner_gateway_request(request, "GET", "/tasks", query=query),
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/api/tasks", status_code=201)
    async def create_browser_task(request: Request):
        try:
            payload = await request.json()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid task request") from exc
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="invalid task request")
        instruction = payload.get("instruction")
        workspace = payload.get("workspace") or required_env("VOICE_DEFAULT_WORKSPACE")
        if not isinstance(instruction, str) or not isinstance(workspace, str):
            raise HTTPException(status_code=400, detail="invalid task request")
        result = await owner_gateway_request(
            request,
            "POST",
            "/tasks",
            body={"instruction": instruction, "workspace": workspace},
        )
        return JSONResponse(result, status_code=201, headers={"Cache-Control": "no-store"})

    @app.post("/api/tasks/{proposal_id}/approve")
    async def approve_browser_task(proposal_id: str, request: Request):
        return JSONResponse(
            await owner_gateway_request(request, "POST", f"/tasks/{proposal_id}/approve"),
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/api/tasks/{proposal_id}/cancel")
    async def cancel_browser_task(proposal_id: str, request: Request):
        return JSONResponse(
            await owner_gateway_request(request, "POST", f"/tasks/{proposal_id}/cancel"),
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/tasks/{proposal_id}/progress")
    async def browser_task_progress(proposal_id: str, request: Request):
        try:
            after = int(request.query_params.get("after", "0"))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid progress cursor") from exc
        if after < 0:
            raise HTTPException(status_code=400, detail="invalid progress cursor")
        return JSONResponse(
            await owner_gateway_request(
                request,
                "GET",
                f"/tasks/{proposal_id}/progress",
                query={"after": after},
            ),
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/tasks/{proposal_id}/artifacts/{name}")
    async def browser_task_artifact(proposal_id: str, name: str, request: Request):
        content, content_type, disposition = await owner_gateway_artifact(
            request, proposal_id, name
        )
        return Response(
            content=content,
            media_type=content_type,
            headers={
                "Content-Disposition": disposition,
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )

    @app.get("/api/tasks/{proposal_id}/speech")
    async def task_speech(proposal_id: str, request: Request):
        task = await owner_gateway_request(request, "GET", f"/tasks/{proposal_id}")
        spoken = task_spoken_text(task)
        return Response(
            content=await broker_speech(spoken),
            media_type="audio/wav",
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/api/music/generations", status_code=202)
    async def create_browser_song(request: Request):
        try:
            payload = await request.json()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid song request") from exc
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="invalid song request")
        brief = payload.get("brief")
        style = payload.get("style")
        workspace = payload.get("workspace") or required_env("VOICE_DEFAULT_WORKSPACE")
        duration = payload.get("durationSeconds", 120)
        if (
            not isinstance(brief, str)
            or not isinstance(style, str)
            or not isinstance(workspace, str)
            or not isinstance(duration, int)
        ):
            raise HTTPException(status_code=400, detail="invalid song request")
        result = await owner_gateway_request(
            request,
            "POST",
            "/music/generations",
            body={
                "brief": brief,
                "style": style,
                "workspace": workspace,
                "durationSeconds": duration,
            },
        )
        return JSONResponse(result, status_code=202, headers={"Cache-Control": "no-store"})

    @app.get("/api/music/generations/{generation_id}")
    async def get_browser_song(generation_id: str, request: Request):
        return JSONResponse(
            await owner_gateway_request(
                request, "GET", f"/music/generations/{generation_id}"
            ),
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/api/music/generations/{generation_id}/render", status_code=202)
    async def render_browser_song(generation_id: str, request: Request):
        return JSONResponse(
            await owner_gateway_request(
                request, "POST", f"/music/generations/{generation_id}/render"
            ),
            status_code=202,
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/api/music/generations/{generation_id}/cancel")
    async def cancel_browser_song(generation_id: str, request: Request):
        return JSONResponse(
            await owner_gateway_request(
                request, "POST", f"/music/generations/{generation_id}/cancel"
            ),
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/music/generations/{generation_id}/audio")
    async def get_browser_song_audio(generation_id: str, request: Request):
        return Response(
            content=await owner_gateway_audio(request, generation_id),
            media_type="audio/mp4",
            headers={"Cache-Control": "private, max-age=300"},
        )

    @app.get("/api/pi-transcript")
    async def get_pi_transcript(request: Request):
        validate_http_identity(request)
        return JSONResponse(
            await broker_transcript_request(),
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/pi-sessions")
    async def get_pi_sessions(request: Request):
        validate_http_identity(request)
        return JSONResponse(
            await broker_sessions_request(operation="browser.pi.sessions.list"),
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/pi-sessions/{session_id}")
    async def get_pi_session_history(session_id: str, request: Request):
        validate_http_identity(request)
        if (
            not session_id
            or len(session_id) > 128
            or not session_id.replace("-", "").replace("_", "").isalnum()
        ):
            raise HTTPException(status_code=400, detail="invalid Pi session ID")
        return JSONResponse(
            await broker_sessions_request(f"/{session_id}", operation="browser.pi.sessions.read"),
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/api/pi-sessions/new", status_code=201)
    async def start_new_pi_session(request: Request):
        validate_http_identity(request)
        return JSONResponse(
            await broker_sessions_request("/new", "POST", operation="browser.pi.sessions.new"),
            status_code=201,
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/api/pi-sessions/{session_id}/resume")
    async def resume_pi_session(session_id: str, request: Request):
        validate_http_identity(request)
        if (
            not session_id
            or len(session_id) > 128
            or not session_id.replace("-", "").replace("_", "").isalnum()
        ):
            raise HTTPException(status_code=400, detail="invalid Pi session ID")
        return JSONResponse(
            await broker_sessions_request(
                f"/{session_id}/resume",
                "POST",
                operation="browser.pi.sessions.resume",
            ),
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/api/pi-message")
    async def send_pi_message(request: Request):
        validate_http_identity(request)
        try:
            payload = await request.json()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid message request") from exc
        message = payload.get("message") if isinstance(payload, dict) else None
        if not isinstance(message, str) or not message.strip():
            raise HTTPException(status_code=400, detail="message is required")
        message = message.strip()
        if len(message) > 8_000:
            raise HTTPException(status_code=413, detail="message is too large")
        result = await broker_pi_message(message)
        return JSONResponse(
            {
                "spoken": result.spoken,
                "presentation": result.presentation,
                "resourceUri": result.resource_uri,
            },
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/api/pi-turn/abort")
    async def abort_pi_turn(request: Request):
        validate_http_identity(request)
        return JSONResponse(
            await broker_abort_pi_turn(),
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/api/pi-speech")
    async def pi_speech(request: Request):
        validate_http_identity(request)
        try:
            payload = await request.json()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid speech request") from exc
        spoken = payload.get("spoken") if isinstance(payload, dict) else None
        if not isinstance(spoken, str) or not spoken.strip():
            raise HTTPException(status_code=400, detail="spoken text is required")
        spoken = spoken.strip()
        if len(spoken) > 2_000:
            raise HTTPException(status_code=413, detail="spoken text is too large")
        return Response(
            content=await broker_speech(spoken),
            media_type="audio/wav",
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/audio-diagnostics")
    async def list_audio_diagnostics(request: Request):
        validate_http_identity(request)
        return JSONResponse(
            {"sessions": audio_diagnostic_store().list()},
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/audio-diagnostics/live")
    async def live_audio_diagnostics(request: Request):
        validate_http_identity(request)
        return JSONResponse(
            audio_diagnostic_store().live_snapshot(),
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/audio-diagnostics/{session_id}/metrics")
    async def audio_diagnostic_metrics(session_id: str, request: Request):
        validate_http_identity(request)
        try:
            payload = audio_diagnostic_store().metrics(session_id)
        except (ValueError, FileNotFoundError) as exc:
            raise HTTPException(status_code=404, detail="audio diagnostic not found") from exc
        return JSONResponse(payload, headers={"Cache-Control": "no-store, private"})

    @app.get("/api/audio-diagnostics/{session_id}/{variant}.wav")
    async def replay_audio_diagnostic(session_id: str, variant: str, request: Request):
        validate_http_identity(request)
        try:
            target = audio_diagnostic_store().audio_path(session_id, variant)
        except (ValueError, FileNotFoundError) as exc:
            raise HTTPException(status_code=404, detail="audio diagnostic not found") from exc
        return FileResponse(
            target,
            media_type="audio/wav",
            headers={"Cache-Control": "no-store, private"},
        )

    @app.get("/api/pi-context")
    async def get_pi_context(request: Request):
        validate_http_identity(request)
        return JSONResponse(
            await broker_context_request("GET", ""),
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/api/pi-context/compact")
    async def compact_pi_context(request: Request):
        validate_http_identity(request)
        return JSONResponse(
            await broker_context_request("POST", "/compact"),
            headers={"Cache-Control": "no-store"},
        )

    main()
