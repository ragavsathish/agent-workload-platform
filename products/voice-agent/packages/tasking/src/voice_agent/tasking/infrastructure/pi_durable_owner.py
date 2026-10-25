"""Private transport for the single Pi Durable storage owner."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class PiDurableOwner:
    def __init__(self, url: str, token_file: Path):
        self.url = url.rstrip("/") + "/private/task"
        self.token_file = token_file

    def _call(self, command: str, **fields: Any) -> Any:
        token = self.token_file.read_text(encoding="utf-8").strip()
        request = Request(
            self.url,
            data=json.dumps({"id": str(uuid.uuid4()), "command": command, **fields}).encode(),
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=30) as response:
                envelope = json.load(response)
        except (HTTPError, URLError) as exc:
            raise RuntimeError("Pi Durable owner is unavailable") from exc
        if not envelope.get("success"):
            raise RuntimeError(str(envelope.get("error", "Pi Durable owner rejected the request")))
        return envelope.get("data")

    def submit(self, kind: str, params: dict[str, Any], request_id: str) -> str:
        result = self._call(
            "submit", requestId=request_id,
            input={"kind": kind, "params": params, "requestId": request_id},
        )
        return str(result["task_id"])

    def get(self, task_id: str) -> dict[str, Any] | None:
        return self._call("get", taskId=task_id)

    def get_many(self, task_ids: list[str]) -> dict[str, dict[str, Any] | None]:
        if not task_ids:
            return {}
        return self._call("get_many", taskIds=task_ids)

    def abort(self, task_id: str) -> str:
        return str(self._call("abort", taskId=task_id)["disposition"])

    def retry(self, task_id: str) -> None:
        self._call("retry", taskId=task_id)
