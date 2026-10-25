"""Exercise the production owner client over the Babashka C2 HTTP protocol."""

import json
import subprocess
from pathlib import Path
from urllib.request import Request, urlopen

import pytest
from voice_agent.tasking.infrastructure.pi_durable_owner import PiDurableOwner


ROOT = Path(__file__).resolve().parents[4]
MOCK = ROOT / "apps/client/tool/container_mock/pi_durable_owner_server.clj"


@pytest.fixture
def mock_owner(tmp_path: Path):
    process = subprocess.Popen(
        ["bb", "-cp", "tool", str(MOCK)], cwd=ROOT / "apps/client",
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    try:
        assert process.stdout is not None
        port = int(process.stdout.readline().strip())
        token_file = tmp_path / "token"
        token_file.write_text("c2-pi-owner-token-000000000000000000000", encoding="utf-8")
        yield PiDurableOwner(f"http://127.0.0.1:{port}", token_file)
    finally:
        process.terminate()
        process.wait(timeout=5)


def select_scenario(owner: PiDurableOwner, scenario: str) -> None:
    request = Request(
        owner.url.replace("/private/task", "/__fixture/pi-owner/scenario"),
        data=json.dumps({"scenario": scenario}).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urlopen(request, timeout=5) as response:
        assert response.status == 200


def test_owner_client_lifecycle_and_idempotency(mock_owner: PiDurableOwner) -> None:
    params = {"workspace": "scratch", "instruction": "create a file"}
    task_id = mock_owner.submit("agent-run", params, "task-1")
    assert task_id == "task-1"
    assert mock_owner.submit("agent-run", params, "task-1") == task_id
    assert mock_owner.get(task_id)["result"]["exit_code"] == 0
    assert mock_owner.get_many([task_id, "missing"])[task_id]["state"] == "completed"
    assert mock_owner.get_many([task_id, "missing"])["missing"] is None
    assert mock_owner.abort(task_id) == "terminal"
    with pytest.raises(RuntimeError, match="different input"):
        mock_owner.submit("agent-run", {**params, "instruction": "changed"}, "task-1")


def test_owner_client_failure_abort_and_retry(mock_owner: PiDurableOwner) -> None:
    select_scenario(mock_owner, "task-failure")
    task_id = mock_owner.submit("agent-run", {"workspace": "scratch"}, "failed-1")
    assert mock_owner.get(task_id)["state"] == "failed"
    mock_owner.retry(task_id)
    assert mock_owner.get(task_id)["state"] == "failed"
    select_scenario(mock_owner, "restart-limit")
    task_id = mock_owner.submit("agent-run", {"workspace": "scratch"}, "parked-1")
    assert mock_owner.get(task_id)["state"] == "pending"
    mock_owner.retry(task_id)
    assert mock_owner.get(task_id)["state"] == "completed"
    select_scenario(mock_owner, "slow")
    task_id = mock_owner.submit("song-render", {"generation_id": "g"}, "slow-1")
    assert mock_owner.get(task_id)["state"] == "running"
    assert mock_owner.abort(task_id) == "marked"
    assert mock_owner.get(task_id)["state"] == "cancelled"
    select_scenario(mock_owner, "owner-unavailable")
    with pytest.raises(RuntimeError, match="unavailable"):
        mock_owner.submit("agent-run", {}, "unavailable-1")
