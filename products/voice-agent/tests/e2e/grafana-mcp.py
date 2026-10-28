#!/usr/bin/env python3
"""Exercise the real Grafana MCP server and verify its bundled MCP Apps."""

from __future__ import annotations

import json
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any


TRACE_SEARCH_TIMEOUT_SECONDS = 120


class GrafanaMcp:
    def __init__(self, url: str, token: str) -> None:
        self.url = url
        self.token = token
        self.session_id: str | None = None
        self.request_id = 0

    def send(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self.request_id += 1
        payload: dict[str, Any] = {
            "jsonrpc": "2.0",
            "id": self.request_id,
            "method": method,
        }
        if params is not None:
            payload["params"] = params
        response = self._post(payload)
        if "error" in response:
            raise RuntimeError(f"Grafana MCP {method} failed: {response['error']}")
        return response["result"]

    def notify(self, method: str) -> None:
        self._post({"jsonrpc": "2.0", "method": method}, expect_response=False)

    def _post(self, payload: dict[str, Any], expect_response: bool = True) -> dict[str, Any]:
        headers = {
            "Accept": "application/json, text/event-stream",
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        request = urllib.request.Request(
            self.url,
            data=json.dumps(payload).encode(),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            self.session_id = response.headers.get("Mcp-Session-Id", self.session_id)
            body = response.read().decode()
            content_type = response.headers.get_content_type()
        if not expect_response:
            return {}
        if content_type == "text/event-stream":
            data = "\n".join(
                line.removeprefix("data: ")
                for line in body.splitlines()
                if line.startswith("data: ")
            )
            return json.loads(data)
        return json.loads(body)


def app_uri(tool: dict[str, Any]) -> str | None:
    metadata = tool.get("_meta", {})
    ui = metadata.get("ui", {}) if isinstance(metadata, dict) else {}
    value = ui.get("resourceUri") if isinstance(ui, dict) else None
    if isinstance(value, str):
        return value
    legacy = metadata.get("ui/resourceUri") if isinstance(metadata, dict) else None
    return legacy if isinstance(legacy, str) else None


def first_trace_at_or_after(
    traces: list[dict[str, Any]], started_at_ns: int
) -> dict[str, Any] | None:
    """Return a trace emitted during this run, ignoring stale Tempo results."""
    for trace in traces:
        try:
            trace_started_at_ns = int(trace["startTimeUnixNano"])
        except (KeyError, TypeError, ValueError):
            continue
        if trace_started_at_ns >= started_at_ns:
            return trace
    return None


def main() -> None:
    product = Path(__file__).resolve().parents[2]
    token = (product / "deploy/secrets/grafana-mcp-caller-token").read_text().strip()
    client = GrafanaMcp("http://127.0.0.1:8000/mcp", token)
    regression_started_at_ns = time.time_ns()
    initialized = client.send(
        "initialize",
        {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "voice-agent-regression", "version": "1"},
        },
    )
    client.notify("notifications/initialized")
    tools = {tool["name"]: tool for tool in client.send("tools/list")["tools"]}

    required = {"get_dashboard_summary", "query_prometheus", "get_tempo_trace"}
    missing = sorted(required - tools.keys())
    if missing:
        raise AssertionError(f"Grafana MCP is missing tools: {missing}")
    trace_app = app_uri(tools["get_tempo_trace"])
    if not trace_app or not trace_app.startswith("ui://"):
        raise AssertionError(
            f"get_tempo_trace does not advertise Grafana's trace MCP App: {trace_app!r}"
        )

    summary = client.send(
        "tools/call",
        {"name": "get_dashboard_summary", "arguments": {"uid": "voice-c4-heatmap"}},
    )
    if summary.get("isError"):
        raise AssertionError(f"C4 dashboard summary failed: {summary}")

    metric = client.send(
        "tools/call",
        {
            "name": "query_prometheus",
            "arguments": {
                "datasourceUid": "prometheus",
                "expr": 'up{job="grafana-mcp"}',
                "endTime": "now",
                "queryType": "instant",
            },
        },
    )
    metric_text = "".join(
        item.get("text", "")
        for item in metric.get("content", [])
        if item.get("type") == "text"
    )
    metric_payload = json.loads(metric_text) if metric_text else {}
    metric_data = metric_payload.get("data", [])
    if (
        metric.get("isError")
        or not metric_data
        or metric_data[0].get("metric", {}).get("job") != "grafana-mcp"
        or metric_data[0].get("value", [None, None])[1] != "1"
    ):
        raise AssertionError(f"PromQL through Grafana MCP failed: {metric}")

    trace: dict[str, Any] | None = None
    trace_search_started = time.monotonic()
    trace_search_deadline = trace_search_started + TRACE_SEARCH_TIMEOUT_SECONDS
    while time.monotonic() < trace_search_deadline:
        searched = client.send(
            "tools/call",
            {
                "name": "search_tempo_traces",
                "arguments": {
                    "datasourceUid": "tempo",
                    "query": '{ resource.service.name = "mcp-grafana" }',
                },
            },
        )
        search_text = "".join(
            item.get("text", "")
            for item in searched.get("content", [])
            if item.get("type") == "text"
        )
        traces = json.loads(search_text).get("traces", []) if search_text else []
        trace = first_trace_at_or_after(traces, regression_started_at_ns)
        if trace is not None:
            break
        remaining = trace_search_deadline - time.monotonic()
        if remaining > 0:
            time.sleep(min(1, remaining))
    if trace is None:
        raise AssertionError(
            "Grafana MCP emitted no queryable Tempo trace from this regression run "
            f"within {TRACE_SEARCH_TIMEOUT_SECONDS} seconds"
        )

    trace_id = trace["traceID"]
    trace_result = client.send(
        "tools/call",
        {
            "name": "get_tempo_trace",
            "arguments": {"datasourceUid": "tempo", "trace_id": trace_id},
        },
    )
    if (
        trace_result.get("isError")
        or trace_result.get("structuredContent", {}).get("traceId") != trace_id
    ):
        raise AssertionError(f"Tempo trace App data was not returned: {trace_result}")

    print(
        json.dumps(
            {
                "server": initialized["serverInfo"],
                "toolCount": len(tools),
                "traceApp": trace_app,
                "traceId": trace_id.zfill(32),
                "traceSearchSeconds": round(time.monotonic() - trace_search_started, 3),
                "dashboard": "voice-c4-heatmap",
                "promql": 'up{job="grafana-mcp"}',
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - black-box failure needs one clear line
        print(f"Grafana MCP regression failed: {error}", file=sys.stderr)
        raise
