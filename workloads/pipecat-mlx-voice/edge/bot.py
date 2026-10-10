"""Tailnet-facing Pipecat process for the isolated Linux VM."""

import os
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger
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
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.openai.stt import OpenAISTTService
from pipecat.services.openai.tts import OpenAITTSService
from pipecat.transports.base_transport import BaseTransport
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams, FastAPIWebsocketTransport
from pipecat.workers.runner import WorkerRunner

load_dotenv(override=True)


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
    model = required_env("OLLAMA_MODEL")

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
                "You are a concise voice assistant. You have no tools and cannot start agent "
                "tasks from this isolated endpoint. Do not claim otherwise."
            ),
        ),
    )
    tts = OpenAITTSService(
        api_key=broker_token,
        base_url=broker_url,
        settings=OpenAITTSService.Settings(model="kokoro", voice="alloy", speed=1.0),
    )

    context = LLMContext()
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
                "content": f"Briefly introduce yourself to the authenticated user {identity}.",
            }
        )
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        await worker.cancel()

    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)
    await runner.run()


async def bot(runner_args: RunnerArguments):
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
        return {"tasks": False, "isolation": "podman-machine"}

    main()
