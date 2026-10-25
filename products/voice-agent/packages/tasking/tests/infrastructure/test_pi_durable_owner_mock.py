"""Exercise the production owner client over the Babashka C2 HTTP protocol."""

import json
import subprocess
from pathlib import Path
from urllib.request import Request, urlopen

import allure
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


@allure.epic("Durable work")
@allure.feature("Continue durable work")
@allure.story("C2 owner integration")
def test_owner_client_lifecycle_and_idempotency(mock_owner: PiDurableOwner) -> None:
    params = {"workspace": "scratch", "instruction": "create a file"}
    with allure.step("Given a reachable C2 owner with a scratch task contract"):
        assert mock_owner.url.endswith("/private/task")
    with allure.step("When the product submits the same request twice"):
        task_id = mock_owner.submit("agent-run", params, "task-1")
        assert task_id == "task-1"
        assert mock_owner.submit("agent-run", params, "task-1") == task_id
    with allure.step("Then single and batch queries return the completed public result"):
        result = mock_owner.get(task_id)
        batch = mock_owner.get_many([task_id, "missing"])
        assert result["result"]["exit_code"] == 0
        assert batch[task_id]["state"] == "completed"
        assert batch["missing"] is None
        allure.attach(json.dumps({"task_id": task_id, "result": result, "batch": batch}, indent=2),
                      "owner-query-evidence", allure.attachment_type.JSON)
    with allure.step("And a terminal abort leaves the result intact"):
        assert mock_owner.abort(task_id) == "terminal"
        assert mock_owner.get(task_id)["state"] == "completed"
    with allure.step("But reusing the request ID with different input is rejected"):
        with pytest.raises(RuntimeError, match="different input"):
            mock_owner.submit("agent-run", {**params, "instruction": "changed"}, "task-1")


@allure.epic("Durable work")
@allure.feature("Continue durable work")
@allure.story("C2 owner integration")
def test_owner_client_failure_abort_and_retry(mock_owner: PiDurableOwner) -> None:
    evidence: dict[str, str] = {}
    with allure.step("Given the C2 owner reports a failed task"):
        select_scenario(mock_owner, "task-failure")
        failed_id = mock_owner.submit("agent-run", {"workspace": "scratch"}, "failed-1")
        assert mock_owner.get(failed_id)["state"] == "failed"
    with allure.step("When the product retries it, the failure remains visible"):
        mock_owner.retry(failed_id)
        assert mock_owner.get(failed_id)["state"] == "failed"
        evidence["failed"] = "failed"
    with allure.step("When a parked task is retried, it completes"):
        select_scenario(mock_owner, "restart-limit")
        parked_id = mock_owner.submit("agent-run", {"workspace": "scratch"}, "parked-1")
        assert mock_owner.get(parked_id)["state"] == "pending"
        mock_owner.retry(parked_id)
        assert mock_owner.get(parked_id)["state"] == "completed"
        evidence["retried"] = "completed"
    with allure.step("When active work is aborted, queries report cancellation"):
        select_scenario(mock_owner, "slow")
        running_id = mock_owner.submit("song-render", {"generation_id": "g"}, "slow-1")
        assert mock_owner.get(running_id)["state"] == "running"
        assert mock_owner.abort(running_id) == "marked"
        assert mock_owner.get(running_id)["state"] == "cancelled"
        evidence["aborted"] = "cancelled"
    with allure.step("Then an unavailable owner surfaces a bounded error"):
        select_scenario(mock_owner, "owner-unavailable")
        with pytest.raises(RuntimeError, match="unavailable"):
            mock_owner.submit("agent-run", {}, "unavailable-1")
        allure.attach(json.dumps(evidence),
                      "owner-failure-evidence", allure.attachment_type.JSON)
