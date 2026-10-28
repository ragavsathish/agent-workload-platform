"""Private transport for the single Pi Durable storage owner."""

from __future__ import annotations

import errno
import json
import uuid
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from opentelemetry import metrics, trace

_transport_errors = metrics.get_meter("pipecat-mlx-voice").create_counter(
    "pi_durable.owner.transport.errors",
    description="Pi Durable owner transport failures by bounded cause and command",
)


def _failure_kind(exc: HTTPError | URLError | TimeoutError) -> str:
    if isinstance(exc, HTTPError):
        code = exc.code or 0
        if 400 <= code < 500:
            return "http_4xx"
        if 500 <= code < 600:
            return "http_5xx"
        return "http_other"
    reason = exc.reason if isinstance(exc, URLError) else exc
    if isinstance(reason, TimeoutError):
        return "timeout"
    if isinstance(reason, OSError):
        if reason.errno is None:
            return "network_other"
        return {
            errno.ENETUNREACH: "network_unreachable",
            errno.EHOSTUNREACH: "host_unreachable",
            errno.ECONNREFUSED: "connection_refused",
            errno.ECONNRESET: "connection_reset",
            errno.ETIMEDOUT: "timeout",
        }.get(reason.errno, "network_other")
    return "network_other"


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
        except (HTTPError, URLError, TimeoutError) as exc:
            attributes = {"owner.command": command, "owner.failure_kind": _failure_kind(exc)}
            _transport_errors.add(1, attributes)
            span = trace.get_current_span()
            span.set_attributes(attributes)
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

    def describe(self, task_id: str) -> dict[str, Any] | None:
        return self._call("describe", taskId=task_id)

    def describe_product(self, task_id: str) -> dict[str, Any] | None:
        return self._call("describe_product", taskId=task_id)

    def cancel_product(self, task_id: str, identity: str) -> None:
        self._call("cancel_product", taskId=task_id, identity=identity)

    def progress(self, task_id: str, after: int = 0, limit: int = 40) -> list[dict[str, Any]]:
        return self._call("progress", taskId=task_id, after=after, limit=limit)

    def list_native(self, identity: str, limit: int = 50) -> list[dict[str, Any]]:
        return self._call("list_native", identity=identity, limit=limit)

    def abort(self, task_id: str) -> str:
        return str(self._call("abort", taskId=task_id)["disposition"])

    def retry(self, task_id: str) -> None:
        self._call("retry", taskId=task_id)
