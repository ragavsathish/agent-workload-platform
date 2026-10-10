"""Differentially probe Python and Swift broker contracts without logging content."""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Observation:
    case: str
    endpoint: str
    status: int
    media_type: str
    shape: str
    byte_count: int
    first_byte_seconds: float
    wall_seconds: float


def load_environment(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key] = value
    return values


def request(
    base_url: str,
    token: str,
    endpoint: str,
    *,
    payload: dict[str, Any] | bytes | None = None,
    content_type: str = "application/json",
    authenticated: bool = True,
) -> tuple[int, str, bytes, float, float]:
    body = payload if isinstance(payload, bytes) else (
        json.dumps(payload).encode() if payload is not None else None
    )
    headers = {"Content-Type": content_type}
    if authenticated:
        headers["Authorization"] = f"Bearer {token}"
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(
            urllib.request.Request(
                f"{base_url.rstrip('/')}{endpoint}",
                data=body,
                headers=headers,
                method="GET" if body is None else "POST",
            ),
            timeout=300,
        ) as response:
            first = response.read(1)
            first_byte = time.perf_counter() - started
            body = first + response.read()
            return (
                response.status,
                response.headers.get_content_type(),
                body,
                first_byte,
                time.perf_counter() - started,
            )
    except urllib.error.HTTPError as error:
        first = error.read(1)
        first_byte = time.perf_counter() - started
        body = first + error.read()
        return (
            error.code,
            error.headers.get_content_type(),
            body,
            first_byte,
            time.perf_counter() - started,
        )


def json_shape(body: bytes) -> str:
    try:
        value = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return "invalid-json"
    return "object:" + ",".join(sorted(value)) if isinstance(value, dict) else type(value).__name__


def observe(
    base_url: str, token: str, model: str, stt_wav: bytes | None
) -> list[Observation]:
    cases: list[tuple[str, str, dict[str, Any] | bytes | None, str, bool, str]] = [
        ("health-auth", "/health", None, "application/json", True, "json"),
        ("health-anonymous", "/health", None, "application/json", False, "json"),
        ("chat-invalid-model", "/v1/chat/completions",
         {"model": "not-allowed", "messages": []}, "application/json", True, "json"),
        ("chat-json", "/v1/chat/completions", {
            "model": model,
            "messages": [{"role": "user", "content": "Reply with exactly WARM."}],
            "stream": False, "temperature": 0, "max_tokens": 32,
        }, "application/json", True, "json"),
        ("chat-sse", "/v1/chat/completions", {
            "model": model,
            "messages": [{"role": "user", "content": "Reply with exactly WARM."}],
            "stream": True, "temperature": 0, "max_tokens": 32,
        }, "application/json", True, "sse"),
        ("tts-pcm", "/v1/audio/speech", {
            "model": "kokoro", "input": "Interface compatibility probe.",
            "voice": "af_heart", "response_format": "pcm", "speed": 1,
        }, "application/json", True, "pcm"),
        ("pi-json", "/v1/pi/chat/completions", {
            "model": "pi-agent",
            "messages": [{"role": "user", "content": "Reply with exactly WARM."}],
            "stream": False,
        }, "application/json", True, "json"),
        ("pi-sse", "/v1/pi/chat/completions", {
            "model": "pi-agent",
            "messages": [{"role": "user", "content": "Reply with exactly WARM."}],
            "stream": True,
        }, "application/json", True, "sse"),
        ("pi-tools-rejected", "/v1/pi/chat/completions", {
            "model": "pi-agent",
            "messages": [{"role": "user", "content": "Reply with exactly WARM."}],
            "tools": [{"type": "function", "function": {"name": "shell"}}],
        }, "application/json", True, "json"),
    ]
    if stt_wav is not None:
        boundary = f"broker-contract-{uuid.uuid4().hex}"
        multipart = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="probe.wav"\r\n'
            "Content-Type: audio/wav\r\n\r\n"
        ).encode() + stt_wav + f"\r\n--{boundary}--\r\n".encode()
        cases.append(("stt-owner", "/v1/audio/transcriptions", multipart,
                      f"multipart/form-data; boundary={boundary}", True, "json"))

    observations: list[Observation] = []
    for case, endpoint, payload, content_type, authenticated, kind in cases:
        status, media_type, body, first_byte, elapsed = request(
            base_url, token, endpoint, payload=payload,
            content_type=content_type, authenticated=authenticated)
        if kind == "json":
            shape = json_shape(body)
        elif kind == "sse":
            shape = (
                "openai-sse" if b"chat.completion.chunk" in body and b"data: [DONE]" in body
                else "invalid-sse"
            )
        else:
            shape = "even-pcm16" if body and len(body) % 2 == 0 else "invalid-pcm"
        observations.append(Observation(
            case=case,
            endpoint=f"{endpoint}:{'auth' if authenticated else 'anonymous'}",
            status=status, media_type=media_type, shape=shape,
            byte_count=len(body), first_byte_seconds=first_byte, wall_seconds=elapsed))
    return observations


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python-url", default="http://127.0.0.1:9443")
    parser.add_argument("--swift-url", default="http://127.0.0.1:9445")
    parser.add_argument("--env-file", type=Path,
                        default=Path(__file__).parents[1] / "server/.env")
    parser.add_argument("--stt-wav", type=Path)
    args = parser.parse_args()
    environment = load_environment(args.env_file)
    wav = args.stt_wav.read_bytes() if args.stt_wav else None
    python = observe(args.python_url, environment["INFERENCE_BROKER_TOKEN"],
                     environment["OLLAMA_MODEL"], wav)
    swift = observe(args.swift_url, environment["INFERENCE_BROKER_TOKEN"],
                    environment["OLLAMA_MODEL"], wav)
    compatible = all(
        left.case == right.case and left.endpoint == right.endpoint and left.status == right.status
        and left.media_type == right.media_type and left.shape == right.shape
        for left, right in zip(python, swift, strict=True)
    )
    print(json.dumps({
        "compatible": compatible,
        "python": [asdict(item) for item in python],
        "swift": [asdict(item) for item in swift],
    }, indent=2))
    if not compatible:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
