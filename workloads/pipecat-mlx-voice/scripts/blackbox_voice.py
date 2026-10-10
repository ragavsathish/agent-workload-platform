"""Drive one synthetic utterance through the public Pipecat WebSocket boundary.

This file is executed with the voice-edge virtualenv so the test uses the exact
protobuf and WebSocket libraries shipped in the appliance image.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import socket
import sys
from collections import Counter
from typing import Any

import httpx
import numpy as np
import websockets
from pipecat.serializers.protobuf import frame_protos


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("utterances", nargs="+")
    parser.add_argument("--identity", default="you@example.com")
    parser.add_argument(
        "--origin", default="https://pipecat-edge.example-tailnet.ts.net"
    )
    parser.add_argument("--timeout", type=float, default=120.0)
    return parser.parse_args()


def protobuf_message(payload: dict[str, Any]) -> bytes:
    frame = frame_protos.Frame()
    frame.message.data = json.dumps(payload)
    return frame.SerializeToString()


def audio_frame(pcm: bytes, sample_rate: int = 16_000) -> bytes:
    frame = frame_protos.Frame()
    frame.audio.audio = pcm
    frame.audio.sample_rate = sample_rate
    frame.audio.num_channels = 1
    return frame.SerializeToString()


def resample_24k_to_16k(pcm: bytes) -> bytes:
    source = np.frombuffer(pcm, dtype=np.int16).astype(np.float32)
    target_size = round(source.size * 2 / 3)
    target = np.interp(
        np.linspace(0, source.size - 1, target_size),
        np.arange(source.size),
        source,
    )
    return np.clip(target, -32768, 32767).astype(np.int16).tobytes()


async def synthesize(client: httpx.AsyncClient, utterance: str) -> bytes:
    token = open("/run/secrets/broker-token", encoding="utf-8").read().strip()
    base_url = os.environ["INFERENCE_BROKER_BASE_URL"].removesuffix("/v1")
    # Tailscale's userspace resolver advertises an unreachable synthetic IPv6
    # answer for container hostnames. Pin the test producer to Docker's IPv4
    # host-gateway; the Pipecat OpenAI client is tested separately end-to-end.
    broker_ipv4 = socket.getaddrinfo(
        "inference-broker", 9443, socket.AF_INET, socket.SOCK_STREAM
    )[0][4][0]
    base_url = f"http://{broker_ipv4}:9443"
    response = await client.post(
        f"{base_url}/v1/audio/speech",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "model": "kokoro",
            "input": utterance,
            "voice": "af_heart",
            "response_format": "pcm",
        },
        timeout=300,
    )
    response.raise_for_status()
    return resample_24k_to_16k(response.content)


async def run(args: argparse.Namespace) -> dict[str, Any]:
    async with httpx.AsyncClient() as client:
        utterance_audio = [
            (utterance, await synthesize(client, utterance))
            for utterance in args.utterances
        ]
        start = await client.post(
            "http://127.0.0.1:7860/start",
            headers={"origin": args.origin},
            json={"transport": "websocket"},
        )
        start.raise_for_status()
        token = start.json()["token"]

    events: list[str] = []
    transcriptions: list[str] = []
    assistant_text: list[str] = []
    intro_finished = asyncio.Event()
    response_finished = asyncio.Event()
    sent_audio = False

    async with websockets.connect(
        f"ws://127.0.0.1:7860/ws-client?token={token}",
        origin=args.origin,
        additional_headers={"tailscale-user-login": args.identity},
        max_size=4 * 1024 * 1024,
    ) as socket:
        await socket.send(
            protobuf_message(
                {
                    "label": "rtvi-ai",
                    "type": "client-ready",
                    "id": "blackbox-ready",
                    "data": {"version": "1.0.0", "about": {"library": "blackbox"}},
                }
            )
        )

        async def receive() -> None:
            nonlocal sent_audio
            async for raw in socket:
                if not isinstance(raw, bytes):
                    continue
                frame = frame_protos.Frame.FromString(raw)
                if frame.WhichOneof("frame") != "message":
                    continue
                payload = json.loads(frame.message.data)
                event_type = str(payload.get("type", ""))
                events.append(event_type)
                data = payload.get("data")
                if event_type == "user-transcription" and isinstance(data, dict):
                    text = data.get("text")
                    if isinstance(text, str) and text:
                        transcriptions.append(text)
                if event_type == "bot-transcription" and isinstance(data, dict):
                    text = data.get("text")
                    if isinstance(text, str) and text:
                        assistant_text.append(text)
                if event_type == "error":
                    raise RuntimeError(f"Pipecat error: {data}")
                if event_type == "bot-stopped-speaking":
                    if sent_audio:
                        response_finished.set()
                    else:
                        intro_finished.set()

        receiver = asyncio.create_task(receive())
        try:
            await asyncio.wait_for(intro_finished.wait(), timeout=args.timeout)
            chunk_bytes = 640  # 20 ms, mono int16 at 16 kHz
            for _utterance, pcm in utterance_audio:
                response_finished.clear()
                sent_audio = True
                for offset in range(0, len(pcm), chunk_bytes):
                    await socket.send(audio_frame(pcm[offset : offset + chunk_bytes]))
                    await asyncio.sleep(0.02)
                for _ in range(50):  # one second of trailing silence for VAD
                    await socket.send(audio_frame(bytes(chunk_bytes)))
                    await asyncio.sleep(0.02)
                await asyncio.wait_for(response_finished.wait(), timeout=args.timeout)
        finally:
            receiver.cancel()
            await asyncio.gather(receiver, return_exceptions=True)

    return {
        "utterances": args.utterances,
        "pcm_bytes_16khz": [len(pcm) for _, pcm in utterance_audio],
        "transcriptions": transcriptions,
        "assistant_text": assistant_text,
        "event_counts": dict(Counter(events)),
    }


if __name__ == "__main__":
    try:
        print(json.dumps(asyncio.run(run(parse_args())), indent=2))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        raise
