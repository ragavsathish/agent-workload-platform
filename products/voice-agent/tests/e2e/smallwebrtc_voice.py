"""Synthetic SmallWebRTC voice probe for the deployed edge container."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import socket
from fractions import Fraction
from pathlib import Path

import httpx
import numpy as np
from aiortc import (
    MediaStreamError,
    MediaStreamTrack,
    RTCPeerConnection,
    RTCSessionDescription,
)
from av import AudioFrame

MCP_APP_SCENARIOS = (
    {
        "name": "mermaid",
        "utterance": "Show a simple flow diagram from voice to Pi.",
        "resource_uri": "ui://mermaid/main",
        "kind": "flow",
    },
    {
        "name": "marp",
        "utterance": "Show two short slides about the voice to Pi flow.",
        "resource_uri": "ui://slides/marp.html",
        "kind": "slides",
    },
    {
        "name": "excalidraw",
        "utterance": "Show an editable Excalidraw diagram of voice to Pi.",
        "resource_uri": "ui://excalidraw/mcp-app.html",
        "kind": "excalidraw",
    },
    {
        "name": "grafana",
        "utterance": "Show the newest Tempo trace.",
        "resource_uri": "ui://grafana/trace.html",
        "kind": "grafana-trace",
    },
    {
        "name": "playwright",
        "utterance": "Show the latest Gitea commits Playwright trace.",
        "resource_uri": "ui://playwright-trace-viewer/main.html",
        "kind": "playwright-trace-viewer",
    },
    {
        "name": "journal-review",
        "utterance": "Show the active journal extraction for review.",
        "resource_uri": "ui://journal-review/main.html",
        "kind": "journal-review",
    },
)


class SyntheticMicrophone(MediaStreamTrack):
    kind = "audio"

    def __init__(self) -> None:
        super().__init__()
        self._pcm = b""
        self._offset = 0
        self._pts = 0
        self._drained = asyncio.Event()
        self._drained.set()

    def play(self, pcm: bytes) -> None:
        if not self._drained.is_set():
            raise RuntimeError("synthetic microphone is already playing")
        self._pcm = pcm
        self._offset = 0
        self._drained.clear()

    async def wait_until_drained(self, timeout: float) -> None:
        await asyncio.wait_for(self._drained.wait(), timeout=timeout)

    async def recv(self) -> AudioFrame:
        samples = 320  # 20 ms at 16 kHz
        if self._offset < len(self._pcm):
            end = self._offset + samples * 2
            payload = self._pcm[self._offset : end]
            self._offset = end
            if self._offset >= len(self._pcm):
                self._drained.set()
        else:
            # Keep RTP flowing between turns and while the welcome turn runs.
            payload = b""
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
    token = (
        await asyncio.to_thread(
            Path("/run/secrets/broker-token").read_text,
            encoding="utf-8",
        )
    ).strip()
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


async def run_voice_session(
    utterances: list[str], identity: str, origin: str, timeout: float
) -> list[dict[str, object]]:
    if not utterances:
        raise ValueError("voice session requires at least one utterance")
    pcms = [await synthesize(utterance) for utterance in utterances]
    peer = RTCPeerConnection()
    microphone = SyntheticMicrophone()
    peer.addTrack(microphone)
    channel = peer.createDataChannel("data")
    events: list[str] = []
    server_messages: list[dict[str, object]] = []
    output_bytes = 0
    ready = asyncio.Event()
    welcome_done = asyncio.Event()
    response_done = asyncio.Event()
    awaiting_response = False

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
        nonlocal awaiting_response
        try:
            payload = json.loads(raw if isinstance(raw, str) else raw.decode())
            event_type = str(payload.get("type", ""))
            events.append(event_type)
            if event_type == "server-message":
                message = payload.get("data")
                if isinstance(message, dict):
                    nested = message.get("data")
                    server_messages.append(
                        nested if isinstance(nested, dict) else message
                    )
            if event_type == "bot-stopped-speaking" and ready.is_set():
                if awaiting_response:
                    response_done.set()
                else:
                    welcome_done.set()
        except (AttributeError, json.JSONDecodeError, UnicodeDecodeError):
            return

    @peer.on("track")
    def on_track(track: MediaStreamTrack) -> None:
        async def consume() -> None:
            nonlocal output_bytes
            while True:
                try:
                    frame = await track.recv()
                except MediaStreamError:
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
    # The server starts a welcome turn after client-ready. Do not let the
    # synthetic microphone interrupt it: browser users naturally wait for this
    # cue, and the black-box probe must exercise the same turn boundary.
    await asyncio.wait_for(welcome_done.wait(), timeout=timeout)
    results: list[dict[str, object]] = []
    try:
        for utterance, pcm in zip(utterances, pcms, strict=True):
            event_start = len(events)
            message_start = len(server_messages)
            output_start = output_bytes
            response_done.clear()
            awaiting_response = True
            microphone.play(pcm)
            await microphone.wait_until_drained(timeout)
            # Give VAD one second of trailing silence after each utterance.
            await asyncio.sleep(1.0)
            try:
                await asyncio.wait_for(response_done.wait(), timeout=timeout)
            except TimeoutError:
                pass
            results.append({
                "utterance": utterance,
                "events": events[event_start:],
                "server_messages": server_messages[message_start:],
                "output_bytes": output_bytes - output_start,
                "response_completed": response_done.is_set(),
            })
            awaiting_response = False
    finally:
        await peer.close()
    return results


async def run(
    utterance: str, identity: str, origin: str, timeout: float
) -> dict[str, object]:
    return (await run_voice_session([utterance], identity, origin, timeout))[0]


def matching_mcp_app(
    result: dict[str, object], resource_uri: str, kind: str | None = None
) -> dict[str, object] | None:
    messages = result.get("server_messages")
    if not isinstance(messages, list):
        return None
    for message in messages:
        if not isinstance(message, dict) or message.get("resourceUri") != resource_uri:
            continue
        presentation = message.get("presentation")
        if kind is None or (
            isinstance(presentation, dict) and presentation.get("kind") == kind
        ):
            return message
    return None


def assert_result(
    result: dict[str, object], resource_uri: str | None, kind: str | None
) -> None:
    if not result["response_completed"] or not result["output_bytes"]:
        raise AssertionError("Voice response or remote audio did not complete")
    if resource_uri and matching_mcp_app(result, resource_uri, kind) is None:
        expected = f"{resource_uri} ({kind})" if kind else resource_uri
        raise AssertionError(f"Expected RTVI MCP App {expected!r} was not received")


def result_summary(
    name: str, result: dict[str, object], resource_uri: str, kind: str
) -> dict[str, object]:
    message = matching_mcp_app(result, resource_uri, kind)
    presentation = message.get("presentation") if message else None
    return {
        "name": name,
        "utterance": result["utterance"],
        "resourceUri": resource_uri,
        "kind": kind,
        "title": presentation.get("title") if isinstance(presentation, dict) else None,
        "outputBytes": result["output_bytes"],
        "responseCompleted": result["response_completed"],
    }


async def run_all_mcp_apps(
    identity: str, origin: str, timeout: float
) -> list[dict[str, object]]:
    summaries = []
    for scenario in MCP_APP_SCENARIOS:
        result = await run(scenario["utterance"], identity, origin, timeout)
        assert_result(result, scenario["resource_uri"], scenario["kind"])
        summaries.append(
            result_summary(
                scenario["name"],
                result,
                scenario["resource_uri"],
                scenario["kind"],
            )
        )
    return summaries


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("utterance", nargs="*")
    parser.add_argument(
        "--identity",
        default=os.getenv("EDGE_ALLOWED_USERS", "you@example.com").split(",", 1)[0],
    )
    parser.add_argument(
        "--origin",
        default=os.getenv(
            "PIPECAT_ALLOWED_ORIGINS", "https://pipecat-edge.example.ts.net"
        ).split(",", 1)[0],
    )
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--expect-resource-uri")
    parser.add_argument("--expect-kind")
    parser.add_argument("--all-mcp-apps", action="store_true")
    args = parser.parse_args()
    if args.all_mcp_apps == bool(args.utterance):
        parser.error("provide either an utterance or --all-mcp-apps")
    if args.all_mcp_apps:
        summaries = asyncio.run(
            run_all_mcp_apps(args.identity, args.origin, args.timeout)
        )
        print(json.dumps({"mcpApps": summaries}, indent=2))
        return
    results = asyncio.run(
        run_voice_session(args.utterance, args.identity, args.origin, args.timeout)
    )
    print(json.dumps(results[0] if len(results) == 1 else {"turns": results}, indent=2))
    try:
        for result in results:
            assert_result(result, args.expect_resource_uri, args.expect_kind)
    except AssertionError as error:
        raise SystemExit(str(error)) from error


if __name__ == "__main__":
    main()
