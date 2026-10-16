"""Small Gitea Actions adapter used by the durable task worker."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class WorkflowRun:
    id: int
    status: str
    conclusion: str | None

    @property
    def terminal(self) -> bool:
        return self.status == "completed"


@dataclass(frozen=True)
class GiteaActions:
    endpoint: str
    owner: str
    token: str

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        body = json.dumps(payload).encode() if payload is not None else None
        request = Request(
            f"{self.endpoint.rstrip('/')}/api/v1{path}",
            data=body,
            headers={
                "Authorization": f"token {self.token}",
                "Accept": "application/json",
                **({"Content-Type": "application/json"} if body is not None else {}),
            },
            method=method,
        )
        with urlopen(request, timeout=30) as response:
            content = response.read()
        return json.loads(content) if content else {}

    def _run_path(self, repository: str, run_id: int) -> str:
        owner = quote(self.owner, safe="._-")
        repository = quote(repository, safe="._-")
        return f"/repos/{owner}/{repository}/actions/runs/{run_id}"

    def dispatch(
        self,
        *,
        repository: str,
        workflow: str,
        ref: str,
        inputs: dict[str, str],
    ) -> WorkflowRun:
        owner = quote(self.owner, safe="._-")
        repository = quote(repository, safe="._-")
        workflow = quote(workflow, safe="._-")
        query = urlencode({"return_run_details": "true"})
        result = self._request(
            "POST",
            f"/repos/{owner}/{repository}/actions/workflows/{workflow}/dispatches?{query}",
            {"ref": ref, "inputs": inputs},
        )
        return WorkflowRun(id=int(result["workflow_run_id"]), status="queued", conclusion=None)

    def get(self, *, repository: str, run_id: int) -> WorkflowRun:
        result = self._request("GET", self._run_path(repository, run_id))
        conclusion = result.get("conclusion")
        return WorkflowRun(
            id=int(result["id"]),
            status=str(result["status"]),
            conclusion=str(conclusion) if conclusion else None,
        )

    def cancel(self, *, repository: str, run_id: int) -> None:
        self._request("POST", f"{self._run_path(repository, run_id)}/cancel")
