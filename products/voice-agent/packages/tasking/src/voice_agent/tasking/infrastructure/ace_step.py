"""Loopback ACE-Step adapter used only by the durable host worker."""

from __future__ import annotations

import json
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any

from voice_agent.tasking.domain.song_generation import SongManifest


def request_payload(manifest: SongManifest) -> dict[str, object]:
    return {
        "prompt": manifest.style,
        "lyrics": manifest.lyrics,
        "model": "acestep-v15-turbo",
        "thinking": True,
        "use_format": False,
        "vocal_language": "en",
        "audio_format": "wav",
        "audio_duration": manifest.duration_seconds,
        "bpm": manifest.bpm,
        "key_scale": manifest.key_scale,
        "time_signature": manifest.time_signature,
        "inference_steps": 8,
        "shift": 3,
        "batch_size": 1,
    }


def _post_json(base_url: str, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{base_url}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            result = json.loads(response.read(1_000_001))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("ACE-Step API is unavailable") from exc
    if not isinstance(result, dict) or result.get("code") != 200:
        raise RuntimeError("ACE-Step API rejected the generation request")
    return result


def _wait_for_audio(base_url: str, task_id: str, timeout_seconds: int) -> str:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        queried = _post_json(base_url, "/query_result", {"task_id_list": [task_id]})
        rows = queried.get("data")
        row = rows[0] if isinstance(rows, list) and rows else None
        encoded = row.get("result") if isinstance(row, dict) else None
        try:
            results = json.loads(encoded) if isinstance(encoded, str) else []
        except json.JSONDecodeError as exc:
            raise RuntimeError("ACE-Step API returned an invalid task result") from exc
        result = results[0] if isinstance(results, list) and results else None
        if not isinstance(result, dict):
            time.sleep(2)
            continue
        status = result.get("status")
        if status == 1:
            candidate = result.get("file")
            if not isinstance(candidate, str) or not candidate.startswith("/v1/audio?"):
                raise RuntimeError("ACE-Step API returned an invalid audio path")
            return candidate
        if status == 2 or (isinstance(row, dict) and row.get("status") == 2):
            raise RuntimeError("ACE-Step generation failed")
        time.sleep(2)
    raise RuntimeError("ACE-Step generation timed out")


def _download_audio(base_url: str, audio_path: str, max_bytes: int) -> bytes:
    try:
        with urllib.request.urlopen(f"{base_url}{audio_path}", timeout=30) as response:
            wav = response.read(max_bytes + 1)
    except OSError as exc:
        raise RuntimeError("ACE-Step audio download failed") from exc
    if len(wav) > max_bytes:
        raise RuntimeError("ACE-Step audio exceeded the configured size limit")
    return wav


def _encode_m4a(wav: bytes, ffmpeg_binary: str, max_bytes: int) -> bytes:
    with tempfile.TemporaryDirectory(prefix="awp-song-") as temporary:
        wav_path = Path(temporary) / "song.wav"
        m4a_path = Path(temporary) / "song.m4a"
        wav_path.write_bytes(wav)
        completed = subprocess.run(
            [
                ffmpeg_binary,
                "-y",
                "-v",
                "error",
                "-i",
                str(wav_path),
                "-c:a",
                "aac",
                "-b:a",
                "256k",
                "-movflags",
                "+faststart",
                str(m4a_path),
            ],
            capture_output=True,
            check=False,
            timeout=120,
        )
        if completed.returncode != 0 or not m4a_path.is_file():
            raise RuntimeError("FFmpeg could not encode the generated song")
        encoded = m4a_path.read_bytes()
    if not encoded or len(encoded) > max_bytes:
        raise RuntimeError("encoded song is outside its allowed size")
    return encoded


def create_ace_step_renderer(
    *,
    base_url: str,
    timeout_seconds: int,
    ffmpeg_binary: str = "/opt/homebrew/bin/ffmpeg",
    max_audio_bytes: int = 128 * 1024 * 1024,
) -> Callable[[SongManifest], bytes]:
    """Validate configuration once and return the narrow rendering capability."""
    normalized = base_url.rstrip("/")
    parsed = urllib.parse.urlparse(normalized)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise ValueError("ACE-Step API must be loopback HTTP")
    if timeout_seconds < 30 or timeout_seconds > 1_800:
        raise ValueError("music generation timeout must be between 30 and 1800 seconds")

    def render(manifest: SongManifest) -> bytes:
        released = _post_json(normalized, "/release_task", request_payload(manifest))
        data = released.get("data")
        task_id = data.get("task_id") if isinstance(data, dict) else None
        if not isinstance(task_id, str) or not task_id:
            raise RuntimeError("ACE-Step API returned no task ID")
        audio_path = _wait_for_audio(normalized, task_id, timeout_seconds)
        wav = _download_audio(normalized, audio_path, max_audio_bytes)
        return _encode_m4a(wav, ffmpeg_binary, max_audio_bytes)

    return render
