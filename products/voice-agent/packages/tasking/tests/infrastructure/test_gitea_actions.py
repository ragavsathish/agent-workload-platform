import json
from typing import cast
from urllib.request import Request

from voice_agent.tasking.infrastructure.gitea_actions import GiteaActions, WorkflowRun


class Response:
    def __init__(self, payload: dict | None = None):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def read(self) -> bytes:
        return json.dumps(self.payload).encode() if self.payload is not None else b""


def test_dispatch_returns_the_checkpointable_workflow_run_id(monkeypatch) -> None:
    observed: list[Request] = []

    def urlopen(request: Request, timeout: int):
        observed.append(request)
        assert timeout == 30
        return Response({"workflow_run_id": 42, "html_url": "http://gitea/run/42"})

    monkeypatch.setattr("voice_agent.tasking.infrastructure.gitea_actions.urlopen", urlopen)
    actions = GiteaActions("http://gitea.local/", "source-publisher", "token")

    run = actions.dispatch(
        repository="full-wasm-server",
        workflow="build-execution-image.yml",
        ref="0123456789abcdef",
        inputs={"artifact_version": "v2-abc"},
    )

    assert run == WorkflowRun(id=42, status="queued", conclusion=None)
    request = observed[0]
    assert request.method == "POST"
    assert request.full_url.endswith(
        "/api/v1/repos/source-publisher/full-wasm-server/actions/workflows/"
        "build-execution-image.yml/dispatches?return_run_details=true"
    )
    assert json.loads(cast(bytes, request.data or b"")) == {
        "ref": "0123456789abcdef",
        "inputs": {"artifact_version": "v2-abc"},
    }
    assert request.headers["Authorization"] == "token token"


def test_get_and_cancel_address_the_same_repository_run(monkeypatch) -> None:
    observed: list[Request] = []

    def urlopen(request: Request, timeout: int):
        observed.append(request)
        if request.method == "GET":
            return Response({"id": 42, "status": "completed", "conclusion": "success"})
        return Response()

    monkeypatch.setattr("voice_agent.tasking.infrastructure.gitea_actions.urlopen", urlopen)
    actions = GiteaActions("http://gitea.local", "source-publisher", "token")

    run = actions.get(repository="full-wasm-server", run_id=42)
    actions.cancel(repository="full-wasm-server", run_id=42)

    assert run == WorkflowRun(id=42, status="completed", conclusion="success")
    assert [request.method for request in observed] == ["GET", "POST"]
    assert observed[0].full_url.endswith(
        "/api/v1/repos/source-publisher/full-wasm-server/actions/runs/42"
    )
    assert observed[1].full_url.endswith(
        "/api/v1/repos/source-publisher/full-wasm-server/actions/runs/42/cancel"
    )
