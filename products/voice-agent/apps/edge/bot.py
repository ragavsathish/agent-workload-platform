"""Tailnet-facing Pipecat process for the isolated Linux VM."""

import os
import wave
from io import BytesIO
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import HTTPException, Request
from loguru import logger
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
from otel_bridge import configure_pipecat_observers
from visual_response import StreamingSpokenExtractor, parse_visual_response

# Voice content must never reach stdout/stderr. Docker also uses the `none` log driver, but removing
# Loguru's shared handler prevents Pipecat from formatting transcripts or LLM context at all.
logger.remove()

load_dotenv(override=True)
telemetry = configure_telemetry("pipecat-voice-edge")


class VoiceVisualResponseProcessor(FrameProcessor):
    """Split one model response into browser Mermaid and TTS-safe speech."""

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

            response = parse_visual_response(raw)
            await self.pipeline_worker.rtvi.send_server_message(
                {
                    "type": "mermaid",
                    "diagram": response.mermaid,
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


def validate_http_identity(request: Request) -> str:
    try:
        allowed_origins = {
            value.strip()
            for value in required_env("PIPECAT_ALLOWED_ORIGINS").split(",")
            if value.strip()
        }
        origin = request.headers.get("origin", "")
        safe_method = request.method.upper() in {"GET", "HEAD", "OPTIONS"}
        # Browsers commonly omit Origin on same-origin GET/HEAD requests. Keep
        # explicit foreign origins out, and require an allowed origin for every
        # state-changing request. Tailnet identity is required in both cases.
        if (origin and origin not in allowed_origins) or (not safe_method and not origin):
            raise PermissionError("browser origin is not allowed")
        return validate_identity(
            request.headers.get("tailscale-user-login", "").strip().lower()
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


def validate_ingress_identity(request: Request) -> str:
    """Authorize Traefik's owner-only forward-auth request."""
    try:
        return validate_identity(
            request.headers.get("tailscale-user-login", "").strip().lower()
        )
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


async def owner_gateway_request(
    request: Request,
    method: str,
    path: str,
    *,
    body: dict[str, object] | None = None,
) -> object:
    """Proxy one owner-scoped task operation through the narrow gateway."""
    identity = validate_http_identity(request)
    headers = {"Authorization": f"Bearer {required_env('AGENT_GATEWAY_TOKEN')}"}
    url = f"{required_env('AGENT_GATEWAY_BASE_URL').rstrip('/')}{path}"
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0)) as client:
        if method == "GET":
            response = await client.request(
                method, url, headers=headers, params={"identity": identity}
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
            system_instruction=(
                "You are a precise, voice-operated coding agent. "
                "Every final response must be exactly one JSON object with two string fields: "
                '"spoken" and "mermaid". Do not wrap the JSON or Mermaid in code fences. The '
                '"spoken" value is the shortest complete natural-language answer and is the only '
                'text that will be read aloud. The "mermaid" value is a valid Mermaid diagram '
                "that visually captures the current result, state, action, or flow. Prefer a small "
                "flowchart TD unless sequence or state notation explains the answer better. Use "
                "short labels and meaningful directed relationships. Never put Mermaid syntax in "
                'the "spoken" value. '
                "Answer only what the user asked, using the shortest complete response. Lead with "
                "the result or current status. Do not use greetings, filler, praise, repetition, "
                "or unsupported speculation. Prefer concrete names, identifiers, states, and "
                "numbers. Ask one short clarification only when missing information prevents a "
                "correct action. Clearly distinguish requested, pending, completed, failed, and "
                "cancelled actions. Never say an action succeeded until its tool result confirms "
                "success. Report only the relevant facts returned by tools and do not embellish "
                'them. Keep "spoken" in plain sentences without visual formatting. '
                "For ordinary coding, inspection, testing, package installation, and shell work, "
                "act immediately with the native read, write, edit, and bash tools. Do not ask "
                "for confirmation and do not create a task proposal. All four tools run inside "
                "one persistent Gondolin voice VM with a writable dedicated voice workspace at "
                "/workspace. Committed source repositories are served read-only from Gitea. Clone "
                "one into /workspace with `git clone \"$GITEA_BASE_URL/$GITEA_OWNER/<repo>.git\"`. "
                "Use the preconfigured `tea` CLI login named `local` to inspect Gitea repositories, "
                "issues, and pull requests. Its restricted token is read-only. "
                "No host Git directory is mounted, and uncommitted host state is unavailable. Reusable "
                "skills are mounted separately and read-only at /skills. "
                "S3Mock is available only through the AWS CLI. Use "
                "`aws --endpoint-url \"$S3_ENDPOINT_URL\" s3 ...` and the configured "
                "`$S3_BUCKET`; never print AWS credentials. "
                "Pi exposes the available skills in its native system-prompt catalog. When a "
                "request matches a skill, read its complete SKILL.md before acting and follow it "
                "while it remains relevant. Never attempt to modify /skills. "
                "Never describe VM state as Mac host state. You may "
                "make any change the user requests inside that VM and workspace. "
                "Use submit_agent_task when work should continue asynchronously, must target a "
                "durable project workspace, or is better handled by another Pi worker. You may "
                "submit that work yourself without asking for approval. State the exact delegated "
                "instruction and returned task ID. You can also propose, inspect, approve, and "
                "cancel queued tasks with the available tools. Creating a proposal never runs it, "
                "while submit_agent_task creates and immediately queues the task. "
                "After proposing, read back the exact instruction and workspace. Approval is "
                "allowed only in a later user turn when the user explicitly asks to approve that "
                "pending task. Never approve in the same turn as proposal creation and never infer "
                "approval from unrelated speech. Approved durable work runs separately through "
                "Gondolin and Wassette MCP. "
                f"The configured default workspace is exactly {default_workspace}. When the user "
                "says the default or current workspace, use that exact logical name without "
                "rewriting it."
            ),
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
            response = await http_client.request(method, path, **kwargs)
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
                    "description": "Allowlisted logical name of the intended project workspace.",
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
                    "description": "Allowlisted logical name of the project workspace.",
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

    visual_response = VoiceVisualResponseProcessor()
    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            llm,
            visual_response,
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
                    '"Voice interface ready." and a Mermaid flowchart showing Voice connected '
                    "to Pi."
                ),
            }
        )
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        await http_client.aclose()
        await worker.cancel()

    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)
    await runner.run()


async def bot(runner_args: RunnerArguments):
    with telemetry.observe("voice.session"):
        match runner_args:
            case SmallWebRTCRunnerArguments():
                try:
                    identity = resolve_webrtc_identity()
                except PermissionError as exc:
                    logger.warning("Rejected WebRTC edge connection: {}", exc)
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
            case _:
                logger.error("Unsupported runner arguments: {}", type(runner_args))
                return
        await run_bot(transport, identity)


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
        return await call_next(request)

    client_dist = Path(__file__).resolve().parent / "client-dist"
    if (client_dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=client_dist / "assets"), name="assets")

    @app.get("/", include_in_schema=False)
    async def browser_client():
        index = client_dist / "index.html"
        if not index.is_file():
            return JSONResponse({"error": "client build is missing"}, status_code=503)
        return FileResponse(index)

    @app.get("/favicon.svg", include_in_schema=False)
    async def favicon():
        return FileResponse(client_dist / "favicon.svg")

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

    @app.get("/api/ingress-auth", include_in_schema=False)
    async def ingress_auth(request: Request):
        validate_ingress_identity(request)
        return Response(status_code=204)

    @app.get("/api/tasks")
    async def list_browser_tasks(request: Request):
        return JSONResponse(
            await owner_gateway_request(request, "GET", "/tasks"),
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

    @app.get("/api/tasks/{proposal_id}/speech")
    async def task_speech(proposal_id: str, request: Request):
        task = await owner_gateway_request(request, "GET", f"/tasks/{proposal_id}")
        spoken = task_spoken_text(task)
        headers = {"Authorization": f"Bearer {required_env('INFERENCE_BROKER_TOKEN')}"}
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
            raise HTTPException(status_code=502, detail="task speech is unavailable")
        return Response(
            content=pcm_wave(response.content),
            media_type="audio/wav",
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/pi-transcript")
    async def get_pi_transcript(request: Request):
        validate_http_identity(request)
        return JSONResponse(
            await broker_transcript_request(),
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
