"""Exercise the real broker stream adapter against the Clojure Pi Voice container mock."""

import asyncio
import json
import os
import socket
import subprocess
import time
from pathlib import Path

import httpx
import pytest

os.environ.setdefault("INFERENCE_BROKER_TOKEN", "x" * 32)
os.environ.setdefault("OLLAMA_MODEL", "test-model")
os.environ.setdefault("ORCHESTRATOR_ALLOWED_USERS", "owner@example.test")
os.environ.setdefault("AGENT_GATEWAY_TOKEN", "y" * 32)

from voice_agent.speech.presentation import http  # noqa: E402


@pytest.fixture(scope="module")
def pi_voice_mock():
    root = Path(__file__).resolve().parents[4]
    tool = root / "apps/client/tool"
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    process = subprocess.Popen(
        ["bb", "-cp", str(tool), str(tool / "patrol_fixture_server.clj")],
        env={**os.environ, "PATROL_FIXTURE_PORT": str(port),
             "INFERENCE_BROKER_TOKEN": http.BROKER_TOKEN},
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(100):
            if process.poll() is not None:
                raise RuntimeError(f"Pi Voice mock stopped: {process.stderr.read().decode()}")
            try:
                if httpx.get(f"{base}/health", timeout=0.1).status_code == 200:
                    break
            except httpx.HTTPError:
                time.sleep(0.05)
        else:
            raise RuntimeError("Pi Voice mock did not become ready")
        yield base
    finally:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)
        process.stderr.close()


@pytest.mark.parametrize(
    ("scenario", "content", "error"),
    [
        ("ready", "Ready from Pi.", None),
        ("malformed-event", "Recovered", None),
        ("turn-error", "Partial ", "Pi turn failed"),
        ("upstream-unavailable", "", "Pi voice turn failed"),
    ],
)
def test_broker_streams_pi_mock_scenarios(
    pi_voice_mock: str, monkeypatch, scenario: str, content: str, error: str | None,
) -> None:
    monkeypatch.setenv("PI_VOICE_SERVICE_URL", pi_voice_mock)
    configured = httpx.post(f"{pi_voice_mock}/__fixture/pi-voice/scenario", json={"scenario": scenario})
    assert configured.status_code == 200

    async def run():
        async with httpx.AsyncClient(timeout=5) as upstream:
            http.app.state.http = upstream
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=http.app),
                                         base_url="http://broker") as client:
                return await client.post(
                    "/v1/pi/chat/completions",
                    headers={"Authorization": f"Bearer {http.BROKER_TOKEN}"},
                    json={"model": "pi-agent", "stream": True,
                          "messages": [{"role": "user", "content": "Say ready"}]},
                )

    response = asyncio.run(run())
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = [line.removeprefix("data: ") for line in response.text.splitlines()
              if line.startswith("data: ")]
    assert events[-1] == "[DONE]"
    chunks = [json.loads(event) for event in events[:-1]]
    assert "".join(chunk["choices"][0]["delta"].get("content", "")
                   for chunk in chunks if "choices" in chunk) == content
    assert next((chunk["error"]["message"] for chunk in chunks if "error" in chunk), None) == error
    assert all(chunk.get("model") == "pi-agent" for chunk in chunks if "choices" in chunk)
    evidence = httpx.get(f"{pi_voice_mock}/__fixture/pi-voice/evidence").json()
    assert evidence["events"][-1]["scenario"] == scenario
