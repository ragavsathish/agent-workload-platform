"""Small authenticated client for the official Grafana MCP HTTP transport."""

from __future__ import annotations

import json
from typing import Any

import httpx


def decode_mcp_response(response: httpx.Response) -> dict[str, Any]:
    if response.is_error:
        raise RuntimeError(f"Grafana MCP returned HTTP {response.status_code}")
    if not response.content:
        return {}
    if response.headers.get("content-type", "").split(";", 1)[0] == "text/event-stream":
        payloads = [
            line.removeprefix("data: ")
            for line in response.text.splitlines()
            if line.startswith("data: ")
        ]
        if not payloads:
            raise RuntimeError("Grafana MCP returned an empty event stream")
        return json.loads("\n".join(payloads))
    return response.json()


class GrafanaMcpClient:
    def __init__(self, url: str, token: str) -> None:
        self.url = url
        self.token = token
        self._request_id = 0
        self._session_id: str | None = None

    def _headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/json, text/event-stream",
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }
        if self._session_id:
            headers["Mcp-Session-Id"] = self._session_id
        return headers

    async def _post(
        self,
        client: httpx.AsyncClient,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        response = await client.post(self.url, headers=self._headers(), json=payload)
        self._session_id = response.headers.get("Mcp-Session-Id", self._session_id)
        return decode_mcp_response(response)

    async def request(
        self,
        client: httpx.AsyncClient,
        method: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        self._request_id += 1
        payload: dict[str, Any] = {
            "jsonrpc": "2.0",
            "id": self._request_id,
            "method": method,
        }
        if params is not None:
            payload["params"] = params
        response = await self._post(client, payload)
        if "error" in response:
            raise RuntimeError(f"Grafana MCP {method} failed")
        result = response.get("result")
        if not isinstance(result, dict):
            raise RuntimeError(f"Grafana MCP {method} returned an invalid result")
        return result

    async def initialize(self, client: httpx.AsyncClient) -> None:
        await self.request(
            client,
            "initialize",
            {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "pi-voice", "version": "1"},
            },
        )
        await self._post(
            client,
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
        )


async def read_grafana_app(url: str, token: str, uri: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0)) as http:
        client = GrafanaMcpClient(url, token)
        await client.initialize(http)
        return await client.request(http, "resources/read", {"uri": uri})


async def read_grafana_trace(
    url: str,
    token: str,
    *,
    datasource_uid: str,
    trace_id: str,
    focus_span_id: str | None = None,
) -> dict[str, Any]:
    arguments = {"datasourceUid": datasource_uid, "trace_id": trace_id}
    if focus_span_id:
        arguments["focus_span_id"] = focus_span_id
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0)) as http:
        client = GrafanaMcpClient(url, token)
        await client.initialize(http)
        return await client.request(
            http,
            "tools/call",
            {"name": "get_tempo_trace", "arguments": arguments},
        )
