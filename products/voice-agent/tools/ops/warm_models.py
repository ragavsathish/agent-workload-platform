"""Warm every inference model through the isolated edge broker."""

from __future__ import annotations

import io
import json
import struct
import subprocess
import sys
import urllib.request
import wave
from pathlib import Path

INSIDE_CONTAINER = len(sys.argv) == 3 and sys.argv[1] == "--inside-container"
ROOT = Path("/") if INSIDE_CONTAINER else Path(__file__).resolve().parents[2]


def inside_container(model: str) -> None:
    base_url = "http://inference-broker:9443"
    token = Path("/run/secrets/broker-token").read_text(encoding="utf-8").strip()

    def request(path: str, body: bytes, content_type: str, timeout: int = 300):
        return urllib.request.urlopen(
            urllib.request.Request(
                base_url + path,
                data=body,
                headers={"Authorization": f"Bearer {token}", "Content-Type": content_type},
            ),
            timeout=timeout,
        )

    chat = json.dumps(
        {
            "model": model,
            "messages": [
                {"role": "user", "content": "Reply with exactly READY and no other text."}
            ],
            "stream": False,
            "max_tokens": 512,
        }
    ).encode()
    with request("/v1/chat/completions", chat, "application/json") as response:
        message = json.load(response)["choices"][0]["message"]
    assert message.get("content", "").strip() == "READY", message.get("content")
    print("PASS  Ollama chat")

    speech = json.dumps(
        {
            "model": "kokoro",
            "input": "Voice system ready.",
            "voice": "af_heart",
            "response_format": "pcm",
        }
    ).encode()
    with request("/v1/audio/speech", speech, "application/json") as response:
        audio = response.read()
    assert len(audio) > 1000, len(audio)
    print(f"PASS  MLX Kokoro TTS ({len(audio)} PCM bytes)")

    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(struct.pack("<16000h", *([0] * 16000)))
    boundary = "pipecat-warmup-boundary"
    form = (
        (
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="silence.wav"\r\n'
            "Content-Type: audio/wav\r\n\r\n"
        ).encode()
        + wav_buffer.getvalue()
        + f"\r\n--{boundary}--\r\n".encode()
    )
    with request(
        "/v1/audio/transcriptions", form, f"multipart/form-data; boundary={boundary}"
    ) as response:
        transcription = json.load(response)
    assert isinstance(transcription.get("text"), str), transcription
    print("PASS  Parakeet v3 MLX STT")


def main() -> None:
    if INSIDE_CONTAINER:
        inside_container(sys.argv[2])
        return
    values = dict(
        line.split("=", 1)
        for line in (ROOT / "deploy/.env").read_text(encoding="utf-8").splitlines()
        if line and not line.startswith("#") and "=" in line
    )
    model = values.get("OLLAMA_MODEL")
    if not model:
        raise SystemExit("OLLAMA_MODEL is missing from deploy/.env")
    source = Path(__file__).read_bytes()
    command = [
        "docker",
        "compose",
        "--env-file",
        str(ROOT / "deploy/.env"),
        "-f",
        str(ROOT / "deploy/compose.yml"),
        "exec",
        "-T",
        "voice-edge",
        "python",
        "-",
        "--inside-container",
        model,
    ]
    subprocess.run(command, input=source, check=True)
    print("All configured inference models are cached and reachable through the isolated edge.")


if __name__ == "__main__":
    main()
