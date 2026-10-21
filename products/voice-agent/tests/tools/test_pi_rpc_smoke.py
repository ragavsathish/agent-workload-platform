import json
import os
import subprocess
import sys
from pathlib import Path


def test_smoke_command_reports_a_bounded_public_result(tmp_path: Path) -> None:
    fake_rpc = tmp_path / "pi-task-rpc"
    fake_rpc.write_text(
        """#!/usr/bin/env python3
import json
import sys
sys.stdin.read()
answer = {"spoken": "Done.", "presentation": {"kind": "status", "title": "Done", "nodes": [], "edges": []}}
print(json.dumps({"type": "message_end", "message": {"role": "assistant", "content": [{"type": "text", "text": json.dumps(answer)}]}}))
print(json.dumps({"type": "agent_settled"}))
""",
        encoding="utf-8",
    )
    fake_rpc.chmod(0o700)
    fake_pi = tmp_path / "pi"
    fake_pi.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    fake_pi.chmod(0o700)
    gondolin = tmp_path / "gondolin.ts"
    gondolin.write_text("", encoding="utf-8")
    environment = os.environ.copy()
    environment.update(
        {
            "PI_BINARY": str(fake_pi),
            "PI_GONDOLIN_EXTENSION": str(gondolin),
            "PYTHONPATH": "apps/worker/src:packages/tasking/src:packages/telemetry/src",
        }
    )

    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "voice_worker.smoke",
            "--artifact",
            str(fake_rpc),
            "--workspace",
            str(tmp_path),
        ],
        cwd=Path(__file__).parents[2],
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    assert json.loads(completed.stdout) == {
        "presentationKind": "status",
        "spoken": "Done.",
        "status": "ok",
    }
