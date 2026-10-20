"""Narrow Python client for the Gondolin VM operation bridge."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

BRIDGE = Path(__file__).with_name("vm_bridge.mjs")


class VMClient:
    def __init__(self) -> None:
        self.process = subprocess.Popen(
            ["node", str(BRIDGE)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, bufsize=1,
        )
        self.sequence = 0

    def request(self, operation: str, **values):
        if self.process.poll() is not None:
            raise RuntimeError(f"Gondolin bridge exited before {operation}")
        self.sequence += 1
        assert self.process.stdin and self.process.stdout
        self.process.stdin.write(json.dumps({"id": self.sequence, "operation": operation, **values}) + "\n")
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError(f"Gondolin bridge closed during {operation}")
        response = json.loads(line)
        if response.get("id") != self.sequence:
            raise RuntimeError("Gondolin bridge response mismatch")
        if not response.get("ok"):
            raise RuntimeError(response.get("error", "unknown Gondolin error"))
        return response["result"]

    def start(self, options):
        return self.request("start", options=options)

    def run(self, command):
        return self.request("run", command=command)

    def checkpoint(self, path):
        return self.request("checkpoint", path=str(path))

    def close(self):
        if self.process.poll() is None:
            try:
                self.request("close")
            finally:
                assert self.process.stdin
                self.process.stdin.close()
                try:
                    self.process.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()
        if self.process.stdout:
            self.process.stdout.close()
        if self.process.stdin and not self.process.stdin.closed:
            self.process.stdin.close()

    def terminate(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        if self.process.stdin and not self.process.stdin.closed:
            self.process.stdin.close()
        if self.process.stdout:
            self.process.stdout.close()
