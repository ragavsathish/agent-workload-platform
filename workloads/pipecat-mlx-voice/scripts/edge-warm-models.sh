#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ollama_model="$(sed -n 's/^OLLAMA_MODEL=//p' "$repo_dir/server/.env" | tail -1)"
[[ -n "$ollama_model" ]] || { echo "OLLAMA_MODEL is missing from server/.env" >&2; exit 1; }

docker compose --env-file "$repo_dir/server/.env" -f "$repo_dir/deploy/compose.yml" exec -T voice-edge python - "$ollama_model" <<'PY'
import io
import json
import struct
import sys
import urllib.request
import wave

BASE_URL = "http://host.docker.internal:9443"
TOKEN = open("/run/secrets/broker-token", encoding="utf-8").read()


def request(path: str, body: bytes, content_type: str, timeout: int = 300):
    return urllib.request.urlopen(
        urllib.request.Request(
            BASE_URL + path,
            data=body,
            headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": content_type},
        ),
        timeout=timeout,
    )


chat = json.dumps(
    {
        "model": sys.argv[1],
        "messages": [{"role": "user", "content": "Reply with exactly READY and no other text."}],
        "stream": False,
        "max_tokens": 512,
    }
).encode()
with request("/v1/chat/completions", chat, "application/json") as response:
    message = json.load(response)["choices"][0]["message"]
assert message.get("content", "").strip() == "READY", message.get("content")
print("PASS  Ollama chat")

speech = json.dumps(
    {"model": "kokoro", "input": "Voice system ready.", "voice": "af_heart", "response_format": "pcm"}
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
    f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="silence.wav"\r\n'
    "Content-Type: audio/wav\r\n\r\n"
).encode() + wav_buffer.getvalue() + f"\r\n--{boundary}--\r\n".encode()
with request("/v1/audio/transcriptions", form, f"multipart/form-data; boundary={boundary}") as response:
    transcription = json.load(response)
assert isinstance(transcription.get("text"), str), transcription
print("PASS  MLX Whisper STT")
PY

echo "All configured inference models are cached and reachable through the isolated edge."
