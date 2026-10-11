"""Tailnet-facing Pipecat process for the isolated Linux VM."""

import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import HTTPException, Request
from loguru import logger
from pipecat.adapters.schemas.direct_function import DirectFunction
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
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
from pipecat.workers.runner import WorkerRunner
from telemetry import configure_telemetry

# Voice content must never reach stdout/stderr. Docker also uses the `none` log driver, but removing
# Loguru's shared handler prevents Pipecat from formatting transcripts or LLM context at all.
logger.remove()

load_dotenv(override=True)
telemetry = configure_telemetry("pipecat-voice-edge")


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
        return validate_identity(
            request.headers.get("tailscale-user-login", "").strip().lower()
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


async def broker_enrollment_request(
    method: str, path: str, *, json: dict[str, str] | None = None, session: str | None = None
) -> dict[str, object]:
    headers = {"Authorization": f"Bearer {required_env('INFERENCE_BROKER_TOKEN')}"}
    if session:
        headers["X-Speaker-Enrollment-Session"] = session
    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
        response = await client.request(
            method,
            f"{required_env('INFERENCE_BROKER_BASE_URL').rstrip('/')}{path}",
            headers=headers,
            json=json,
        )
    if response.is_error:
        raise HTTPException(status_code=response.status_code, detail="enrollment request rejected")
    payload = response.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="invalid enrollment response")
    return payload


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
        settings=OpenAISTTService.Settings(model="mlx-whisper", language="en"),
    )
    llm = OpenAILLMService(
        api_key=broker_token,
        base_url=llm_base_url,
        settings=OpenAILLMService.Settings(
            model=model,
            system_instruction=(
                "You are a precise voice control interface to Pi, a coding-agent coordinator. "
                "Answer only what the user asked, using the shortest complete response. Lead with "
                "the result or current status. Do not use greetings, filler, praise, repetition, "
                "or unsupported speculation. Prefer concrete names, identifiers, states, and "
                "numbers. Ask one short clarification only when missing information prevents a "
                "correct action. Clearly distinguish requested, pending, completed, failed, and "
                "cancelled actions. Never say an action succeeded until its tool result confirms "
                "success. Report only the relevant facts returned by tools and do not embellish "
                "them. Responses are spoken, so use plain sentences without visual formatting. "
                "You can propose, inspect, approve, and cancel agent tasks with the available "
                "tools. Creating a proposal never runs it. "
                "After proposing, read back the exact instruction and workspace. Approval is "
                "allowed only in a later user turn when the user explicitly asks to approve that "
                "pending task. Never approve in the same turn as proposal creation and never infer "
                "approval from unrelated speech. Pi performs approved work "
                "through Gondolin and Wassette MCP; do not claim the voice VM has host access. "
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
    # In Pi mode the native Pi process owns the same four tools through its
    # restricted extension. Ollama mode keeps executing them in this edge.
    context = LLMContext(tools=[] if llm_backend == "pi" else gateway_tools)
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
    )
    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            llm,
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
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
        observers=[],
    )

    @worker.rtvi.event_handler("on_client_ready")
    async def on_client_ready(rtvi):
        context.add_message(
            {
                "role": "developer",
                "content": (
                    f"The authenticated user is {identity}. Say exactly: Voice interface ready."
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
                        audio_out_enabled=True,
                    ),
                )
            case _:
                logger.error("Unsupported runner arguments: {}", type(runner_args))
                return
        await run_bot(transport, identity)


if __name__ == "__main__":
    from fastapi.responses import FileResponse, JSONResponse
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
            "speakerEnrollment": True,
            "approval": "voice-yolo",
            "isolation": "docker-desktop-compose",
        }

    @app.post("/api/speaker-enrollment/claim")
    async def claim_speaker_enrollment(request: Request):
        validate_http_identity(request)
        body = await request.json()
        token = body.get("token") if isinstance(body, dict) else None
        if not isinstance(token, str) or not 16 <= len(token) <= 128:
            raise HTTPException(status_code=400, detail="invalid enrollment token")
        return await broker_enrollment_request(
            "POST", "/speaker/enrollment/claim", json={"token": token}
        )

    @app.get("/api/speaker-enrollment/status")
    async def get_speaker_enrollment_status(request: Request):
        validate_http_identity(request)
        session = request.headers.get("x-speaker-enrollment-session", "")
        if not 16 <= len(session) <= 128:
            raise HTTPException(status_code=400, detail="invalid enrollment session")
        return await broker_enrollment_request(
            "GET", "/speaker/enrollment/status", session=session
        )

    main()
