"""Benchmark the host MLX inference services without exposing their capability."""

from __future__ import annotations

import argparse
import io
import json
import os
import statistics
import subprocess
import threading
import time
import urllib.request
import uuid
import wave
from collections.abc import Callable
from dataclasses import asdict, dataclass
from itertools import pairwise
from pathlib import Path
from typing import Any

import numpy as np


@dataclass
class ProcessSample:
    pid: int
    rss_mib: float
    cpu_seconds: float
    observed_at: float


@dataclass
class BenchmarkResult:
    stage: str
    iteration: int
    wall_seconds: float
    average_cpu_percent: float
    peak_cpu_percent: float
    baseline_rss_mib: float
    peak_rss_mib: float
    output_units: float
    units_per_second: float
    unit: str


def parse_cpu_time(value: str) -> float:
    parts = value.strip().split(":")
    seconds = float(parts.pop())
    if parts:
        seconds += int(parts.pop()) * 60
    if parts:
        seconds += int(parts.pop()) * 3600
    return seconds


def process_sample(pid: int) -> ProcessSample:
    output = subprocess.check_output(
        ["ps", "-p", str(pid), "-o", "rss=", "-o", "time="],
        text=True,
    ).strip()
    rss, cpu_time = output.split()
    return ProcessSample(
        pid=pid,
        rss_mib=int(rss) / 1024,
        cpu_seconds=parse_cpu_time(cpu_time),
        observed_at=time.perf_counter(),
    )


def find_pid(marker: str) -> int:
    output = subprocess.check_output(["ps", "-axo", "pid=,command="], text=True)
    candidates = []
    for line in output.splitlines():
        if marker in line and Path(__file__).name not in line:
            candidates.append(int(line.strip().split(maxsplit=1)[0]))
    if not candidates:
        raise RuntimeError(f"process not found: {marker}")
    return max(candidates, key=lambda pid: process_sample(pid).rss_mib)


def authorized_request(
    base_url: str,
    token: str,
    path: str,
    body: bytes,
    content_type: str,
    timeout: int = 300,
) -> bytes:
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}{path}",
        data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": content_type},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def json_request(
    base_url: str, token: str, path: str, payload: dict[str, Any]
) -> dict[str, Any]:
    result = authorized_request(
        base_url,
        token,
        path,
        json.dumps(payload).encode(),
        "application/json",
    )
    parsed = json.loads(result)
    if not isinstance(parsed, dict):
        raise TypeError("broker returned a non-object response")
    return parsed


def sample_operation(
    *,
    stage: str,
    iteration: int,
    pid: int,
    operation: Callable[[], tuple[float, str]],
) -> BenchmarkResult:
    before = process_sample(pid)
    samples: list[ProcessSample] = []
    stop = threading.Event()

    def collect() -> None:
        while not stop.wait(0.1):
            try:
                samples.append(process_sample(pid))
            except (subprocess.CalledProcessError, ProcessLookupError):
                return

    sampler = threading.Thread(target=collect, daemon=True)
    sampler.start()
    started = time.perf_counter()
    output_units, unit = operation()
    wall = time.perf_counter() - started
    stop.set()
    sampler.join()
    after = process_sample(pid)
    samples.extend([before, after])
    cpu_delta = max(after.cpu_seconds - before.cpu_seconds, 0)
    peak_cpu = max(
        (
            max(current.cpu_seconds - previous.cpu_seconds, 0)
            / (current.observed_at - previous.observed_at)
            * 100
        )
        for previous, current in pairwise(samples)
        if current.observed_at > previous.observed_at
    )
    return BenchmarkResult(
        stage=stage,
        iteration=iteration,
        wall_seconds=wall,
        average_cpu_percent=cpu_delta / wall * 100,
        peak_cpu_percent=peak_cpu,
        baseline_rss_mib=before.rss_mib,
        peak_rss_mib=max(sample.rss_mib for sample in samples),
        output_units=output_units,
        units_per_second=output_units / wall,
        unit=unit,
    )


def pcm_24k_to_wav_16k(pcm: bytes) -> tuple[bytes, float]:
    source = np.frombuffer(pcm, dtype=np.int16).astype(np.float32)
    target_size = round(source.size * 2 / 3)
    target = np.interp(
        np.linspace(0, source.size - 1, target_size),
        np.arange(source.size),
        source,
    )
    pcm_16k = np.clip(target, -32768, 32767).astype(np.int16).tobytes()
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16_000)
        wav.writeframes(pcm_16k)
    return output.getvalue(), len(pcm_16k) / 2 / 16_000


def multipart_wav(wav: bytes) -> tuple[bytes, str]:
    boundary = f"pipecat-benchmark-{uuid.uuid4().hex}"
    body = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="benchmark.wav"\r\n'
        "Content-Type: audio/wav\r\n\r\n"
    ).encode() + wav + f"\r\n--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


def summarize(results: list[BenchmarkResult]) -> None:
    print(
        "stage  wall_s(p50)  avg_cpu%  peak_cpu%  base_rss_MiB  peak_rss_MiB  throughput"
    )
    for stage in ("llm", "tts", "stt"):
        rows = [result for result in results if result.stage == stage]
        if not rows:
            continue
        unit = rows[0].unit
        print(
            f"{stage:5}  {statistics.median(r.wall_seconds for r in rows):11.2f}  "
            f"{statistics.mean(r.average_cpu_percent for r in rows):8.1f}  "
            f"{max(r.peak_cpu_percent for r in rows):9.1f}  "
            f"{statistics.mean(r.baseline_rss_mib for r in rows):12.0f}  "
            f"{max(r.peak_rss_mib for r in rows):12.0f}  "
            f"{statistics.mean(r.units_per_second for r in rows):10.2f} {unit}/s"
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--iterations", type=int, default=3)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--base-url", default="http://127.0.0.1:9443")
    parser.add_argument(
        "--broker-marker", default="voice_agent.speech.presentation.http"
    )
    parser.add_argument("--label", default="python")
    parser.add_argument("--stt-wav", type=Path)
    parser.add_argument(
        "--skip-stt",
        action="store_true",
        help="benchmark LLM and TTS only; use when no enrolled owner recording is available",
    )
    args = parser.parse_args()
    if args.iterations < 1:
        raise SystemExit("--iterations must be positive")
    if args.skip_stt and args.stt_wav:
        raise SystemExit("--skip-stt and --stt-wav are mutually exclusive")

    env_file = Path(__file__).resolve().parents[1] / "server" / ".env"
    values = {}
    for line in env_file.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key] = value
    token = values["INFERENCE_BROKER_TOKEN"]
    model = values["OLLAMA_MODEL"]
    broker_pid = find_pid(args.broker_marker)

    speech_text = (
        "This is a local Apple Silicon benchmark of the private voice assistant. "
        "It measures speech generation and transcription while keeping all audio on this Mac."
    )
    seed_pcm = authorized_request(
        args.base_url,
        token,
        "/v1/audio/speech",
        json.dumps(
            {
                "model": "kokoro",
                "input": speech_text,
                "voice": "af_heart",
                "response_format": "pcm",
            }
        ).encode(),
        "application/json",
    )
    wav: bytes | None = None
    audio_seconds: float | None = None
    if not args.skip_stt:
        if args.stt_wav:
            owner_wav = args.stt_wav.read_bytes()
            wav = owner_wav
            with wave.open(io.BytesIO(owner_wav), "rb") as source:
                if (
                    source.getnchannels() != 1
                    or source.getsampwidth() != 2
                    or source.getframerate() != 16_000
                ):
                    raise RuntimeError("--stt-wav must be mono PCM16 at 16 kHz")
                audio_seconds = source.getnframes() / source.getframerate()
        else:
            wav, audio_seconds = pcm_24k_to_wav_16k(seed_pcm)
        assert wav is not None
        form, form_type = multipart_wav(wav)
        authorized_request(args.base_url, token, "/v1/audio/transcriptions", form, form_type)
    json_request(
        args.base_url,
        token,
        "/v1/chat/completions",
        {
            "model": model,
            "messages": [{"role": "user", "content": "Reply with exactly WARM."}],
            "stream": False,
            "max_tokens": 32,
        },
    )
    ollama_pid = find_pid("ollama runner --mlx-engine")

    results: list[BenchmarkResult] = []
    for iteration in range(1, args.iterations + 1):
        def llm() -> tuple[float, str]:
            response = json_request(
                args.base_url,
                token,
                "/v1/chat/completions",
                {
                    "model": model,
                    "messages": [
                        {
                            "role": "user",
                            "content": (
                                "In plain text, give ten concise security checks for a private "
                                "voice agent. Do not use more than 160 words."
                            ),
                        }
                    ],
                    "stream": False,
                    "temperature": 0,
                    "max_tokens": 256,
                },
            )
            usage = response.get("usage", {})
            return float(usage.get("completion_tokens", 0)), "tokens"

        results.append(
            sample_operation(
                stage="llm", iteration=iteration, pid=ollama_pid, operation=llm
            )
        )

        generated: list[bytes] = []

        def tts(output: list[bytes] = generated) -> tuple[float, str]:
            pcm = authorized_request(
                args.base_url,
                token,
                "/v1/audio/speech",
                json.dumps(
                    {
                        "model": "kokoro",
                        "input": speech_text,
                        "voice": "af_heart",
                        "response_format": "pcm",
                    }
                ).encode(),
                "application/json",
            )
            output.append(pcm)
            return len(pcm) / 2 / 24_000, "audio-seconds"

        results.append(
            sample_operation(
                stage="tts", iteration=iteration, pid=broker_pid, operation=tts
            )
        )
        if not args.skip_stt:
            if args.stt_wav:
                assert wav is not None and audio_seconds is not None
                current_wav, current_seconds = wav, audio_seconds
            else:
                current_wav, current_seconds = pcm_24k_to_wav_16k(generated[0])
            current_form, current_type = multipart_wav(current_wav)

            def stt(
                form: bytes = current_form,
                content_type: str = current_type,
                seconds: float = current_seconds,
            ) -> tuple[float, str]:
                authorized_request(
                    args.base_url,
                    token,
                    "/v1/audio/transcriptions",
                    form,
                    content_type,
                )
                return seconds, "audio-seconds"

            results.append(
                sample_operation(
                    stage="stt", iteration=iteration, pid=broker_pid, operation=stt
                )
            )

    metadata = {
        "model": model,
        "label": args.label,
        "base_url": args.base_url,
        "iterations": args.iterations,
        "logical_cpus": os.cpu_count(),
        "broker_pid": broker_pid,
        "ollama_pid": ollama_pid,
        "input_audio_seconds": audio_seconds,
        "stt_skipped": args.skip_stt,
        "results": [asdict(result) for result in results],
    }
    if args.json:
        print(json.dumps(metadata, indent=2))
    else:
        input_summary = (
            f"input_audio={audio_seconds:.2f}s"
            if audio_seconds is not None
            else "input_audio=skipped"
        )
        print(
            f"label={args.label} model={model} iterations={args.iterations} logical_cpus={os.cpu_count()} "
            f"{input_summary}"
        )
        summarize(results)


if __name__ == "__main__":
    main()
