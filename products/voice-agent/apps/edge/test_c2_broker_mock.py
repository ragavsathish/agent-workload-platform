"""Exercise the real Voice Edge typed-turn adapter against the C2 broker protocol mock."""

import json
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi import HTTPException

from bot import broker_pi_message

TOOL = Path(__file__).resolve().parents[1] / "client" / "tool"
TOKEN = "c2-mock-broker-token-0000000000000000"


class VoiceEdgeBrokerMockTest(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="voice-c2-broker-")
        ready = Path(cls.temp.name) / "ready.json"
        cls.process = subprocess.Popen(
            ["bb", "-cp", str(TOOL), str(TOOL / "patrol_fixture_server.clj")],
            env={
                **os.environ,
                "PATROL_FIXTURE_HOST": "127.0.0.1",
                "PATROL_FIXTURE_PORT": "0",
                "PATROL_FIXTURE_READY_FILE": str(ready),
            },
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if cls.process.poll() is not None:
                break
            try:
                cls.base_url = f"http://127.0.0.1:{json.loads(ready.read_text())['port']}"
                if httpx.get(f"{cls.base_url}/health", timeout=0.2).status_code == 200:
                    return
            except (OSError, ValueError, KeyError, httpx.HTTPError):
                time.sleep(0.05)
        cls.process.terminate()
        cls.process.wait(timeout=3)
        cls.temp.cleanup()
        raise RuntimeError("C2 broker mock did not become ready")

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=3)
        cls.temp.cleanup()

    async def test_typed_turn_and_broker_failure_contract(self):
        checked = []
        with patch.dict(os.environ, {
            "INFERENCE_BROKER_BASE_URL": f"{self.base_url}/v1",
            "INFERENCE_BROKER_TOKEN": TOKEN,
            "VOICE_DEFAULT_WORKSPACE": "/workspace",
        }):
            for scenario, expected_detail in (
                ("ready", None),
                ("unavailable", "Pi response is unavailable"),
                ("invalid-response", "Pi returned an invalid response"),
                ("empty-response", "Pi returned an empty response"),
            ):
                with self.subTest(scenario=scenario):
                    selected = httpx.post(f"{self.base_url}/__fixture/broker/scenario",
                                          json={"scenario": scenario})
                    self.assertEqual(selected.status_code, 200)
                    if expected_detail:
                        with self.assertRaises(HTTPException) as raised:
                            await broker_pi_message("Explain the current state")
                        self.assertEqual(raised.exception.status_code, 502)
                        self.assertEqual(raised.exception.detail, expected_detail)
                    else:
                        result = await broker_pi_message("Explain the current state")
                        self.assertEqual(result.spoken, "Ready from the broker mock.")
                        self.assertEqual(result.presentation["kind"], "status")

                    evidence = httpx.get(f"{self.base_url}/__fixture/broker/evidence").json()
                    self.assertEqual(len(evidence["events"]), 1)
                    self.assertEqual(evidence["events"][0]["containerId"], "BROKER")
                    self.assertEqual(evidence["events"][0]["path"], "/v1/pi/chat/completions")
                    self.assertEqual(evidence["events"][0]["status"],
                                     502 if scenario == "unavailable" else 200)
                    checked.append({"scenario": scenario,
                                    "brokerStatus": evidence["events"][0]["status"],
                                    "edgeStatus": 502 if expected_detail else 200})
        print("C2_BROKER_EVIDENCE=" + json.dumps({"boundary": "Voice Edge → Inference Broker",
                                                   "scenarios": checked}, separators=(",", ":")))


if __name__ == "__main__":
    unittest.main()
