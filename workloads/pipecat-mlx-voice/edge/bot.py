"""Tailnet-facing Pipecat process for the isolated Linux VM."""

import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
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
from pipecat.runner.types import RunnerArguments, WebSocketRunnerArguments
from pipecat.serializers.protobuf import ProtobufFrameSerializer
from pipecat.services.llm_service import FunctionCallParams
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.openai.stt import OpenAISTTService
from pipecat.services.openai.tts import OpenAITTSService
from pipecat.transports.base_transport import BaseTransport
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams, FastAPIWebsocketTransport
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


def resolve_identity(runner_args: WebSocketRunnerArguments) -> str:
    identity = runner_args.websocket.headers.get("tailscale-user-login", "").strip().lower()
    allowed = {
        value.strip().lower()
        for value in required_env("EDGE_ALLOWED_USERS").split(",")
        if value.strip()
    }
    if not identity:
        raise PermissionError("connect through Tailscale Serve")
    if identity not in allowed:
        raise PermissionError("tailnet identity is not allowed")
    return identity


async def run_bot(transport: BaseTransport, identity: str):
    broker_url = required_env("INFERENCE_BROKER_BASE_URL")
    broker_token = required_env("INFERENCE_BROKER_TOKEN")
    gateway_url = required_env("AGENT_GATEWAY_BASE_URL").rstrip("/")
    gateway_token = required_env("AGENT_GATEWAY_TOKEN")
    model = required_env("OLLAMA_MODEL")
    default_workspace = required_env("VOICE_DEFAULT_WORKSPACE")

    stt = OpenAISTTService(
        api_key=broker_token,
        base_url=broker_url,
        settings=OpenAISTTService.Settings(model="mlx-whisper", language="en"),
    )
    llm = OpenAILLMService(
        api_key=broker_token,
        base_url=broker_url,
        settings=OpenAILLMService.Settings(
            model=model,
            system_instruction=(
                "You are a concise voice interface to Pi, a coding-agent coordinator. Responses "
                "are spoken, so avoid visual formatting. You can propose, inspect, approve, and "
                "cancel agent tasks with the available tools. Creating a proposal never runs it. "
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
    tools: list[FunctionSchema | DirectFunction] = [
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
    context = LLMContext(tools=tools)
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
            case WebSocketRunnerArguments():
                try:
                    identity = resolve_identity(runner_args)
                except PermissionError as exc:
                    logger.warning("Rejected edge connection: {}", exc)
                    await runner_args.websocket.close(code=1008, reason=str(exc))
                    return
                transport = FastAPIWebsocketTransport(
                    websocket=runner_args.websocket,
                    params=FastAPIWebsocketParams(
                        audio_in_enabled=True,
                        audio_out_enabled=True,
                        add_wav_header=False,
                        serializer=ProtobufFrameSerializer(),
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
            "approval": "voice-yolo",
            "isolation": "docker-desktop-compose",
        }

    main()
