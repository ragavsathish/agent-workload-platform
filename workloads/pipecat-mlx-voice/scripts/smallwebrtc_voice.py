"""Synthetic SmallWebRTC voice probe for the deployed edge container."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import socket
from fractions import Fraction

import httpx
import numpy as np
from aiortc import MediaStreamTrack, RTCPeerConnection, RTCSessionDescription
from av import AudioFrame


class SyntheticMicrophone(MediaStreamTrack):
    kind = "audio"

    def __init__(self, pcm: bytes) -> None:
        super().__init__()
        self._pcm = pcm
        self._offset = 0
        self._pts = 0

    async def recv(self) -> AudioFrame:
        samples = 320  # 20 ms at 16 kHz
        end = self._offset + samples * 2
        payload = self._pcm[self._offset:end]
        self._offset = end
        payload += b"\0" * max(0, samples * 2 - len(payload))
        frame = AudioFrame(format="s16", layout="mono", samples=samples)
        frame.planes[0].update(payload)
        frame.sample_rate = 16_000
        frame.pts = self._pts
        frame.time_base = Fraction(1, 16_000)
        self._pts += samples
        await asyncio.sleep(0.02)
        return frame


def resample_24k_to_16k(pcm: bytes) -> bytes:
    source = np.frombuffer(pcm, dtype=np.int16).astype(np.float32)
    target_size = round(source.size * 2 / 3)
    target = np.interp(
        np.linspace(0, source.size - 1, target_size),
        np.arange(source.size),
        source,
    )
    return np.clip(target, -32768, 32767).astype(np.int16).tobytes()


async def synthesize(utterance: str) -> bytes:
    token = open("/run/secrets/broker-token", encoding="utf-8").read().strip()
    broker_ipv4 = socket.getaddrinfo(
        "inference-broker", 9443, socket.AF_INET, socket.SOCK_STREAM
    )[0][4][0]
    async with httpx.AsyncClient(timeout=300) as client:
        response = await client.post(
            f"http://{broker_ipv4}:9443/v1/audio/speech",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "model": "kokoro",
                "input": utterance,
                "voice": "af_heart",
                "response_format": "pcm",
            },
        )
        response.raise_for_status()
        return resample_24k_to_16k(response.content)


async def run(utterance: str, identity: str, origin: str, timeout: float) -> dict[str, object]:
    pcm = await synthesize(utterance)
    peer = RTCPeerConnection()
    peer.addTrack(SyntheticMicrophone(pcm))
    channel = peer.createDataChannel("data")
    events: list[str] = []
    output_bytes = 0
    ready = asyncio.Event()
    response_done = asyncio.Event()

    @channel.on("open")
    def on_open() -> None:
        channel.send(
            json.dumps(
                {
                    "label": "rtvi-ai",
                    "type": "client-ready",
                    "id": "smallwebrtc-probe",
                    "data": {"version": "1.0.0", "about": {"library": "probe"}},
                }
            )
        )
        ready.set()

    @channel.on("message")
    def on_message(raw: bytes | str) -> None:
        try:
            payload = json.loads(raw if isinstance(raw, str) else raw.decode())
            event_type = str(payload.get("type", ""))
            events.append(event_type)
            if event_type == "bot-stopped-speaking" and ready.is_set():
                response_done.set()
        except Exception:
            return

    @peer.on("track")
    def on_track(track: MediaStreamTrack) -> None:
        async def consume() -> None:
            nonlocal output_bytes
            while True:
                try:
                    frame = await track.recv()
                except Exception:
                    return
                if isinstance(frame, AudioFrame):
                    output_bytes += len(frame.to_ndarray().tobytes())

        asyncio.create_task(consume())

    offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            "http://127.0.0.1:7860/api/offer",
            headers={
                "Origin": origin,
                "tailscale-user-login": identity,
            },
            json={
                "sdp": peer.localDescription.sdp,
                "type": peer.localDescription.type,
                "request_data": {"transport": "webrtc"},
            },
        )
        response.raise_for_status()
        answer = response.json()
    await peer.setRemoteDescription(
        RTCSessionDescription(sdp=answer["sdp"], type=answer["type"])
    )

    await asyncio.wait_for(ready.wait(), timeout=20)
    for offset in range(0, len(pcm), 640):
        await asyncio.sleep(0.02)
    # Give VAD one second of trailing silence after the utterance.
    await asyncio.sleep(1.0)
    try:
        await asyncio.wait_for(response_done.wait(), timeout=timeout)
    except TimeoutError:
        pass
    result = {
        "utterance": utterance,
        "events": events,
        "output_bytes": output_bytes,
        "response_completed": response_done.is_set(),
    }
    await peer.close()
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("utterance")
    parser.add_argument("--identity", default=os.getenv("EDGE_ALLOWED_USERS", "you@example.com").split(",", 1)[0])
    parser.add_argument("--origin", default=os.getenv("PIPECAT_ALLOWED_ORIGINS", "https://pipecat-edge.example.ts.net").split(",", 1)[0])
    parser.add_argument("--timeout", type=float, default=120.0)
    args = parser.parse_args()
    result = asyncio.run(run(args.utterance, args.identity, args.origin, args.timeout))
    print(json.dumps(result, indent=2))
    if not result["response_completed"] or not result["output_bytes"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
