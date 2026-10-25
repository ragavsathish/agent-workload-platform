import os
import unittest
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from fastapi import HTTPException, Request
from opentelemetry.context import attach, detach
from opentelemetry.trace import (
    NonRecordingSpan,
    SpanContext,
    TraceFlags,
    set_span_in_context,
)

from bot import (
    broker_sessions_request,
    knowledge_entry_path,
    owner_gateway_artifact,
    owner_gateway_audio,
    owner_gateway_request,
    playwright_trace_upstream,
    proxy_playwright_trace,
    summarize_owned_task_progress,
    validate_http_identity,
    validate_ingress_identity,
)


class KnowledgeReviewPathTest(unittest.TestCase):
    def test_path_is_relative_to_the_versioned_gateway_base(self):
        entry_id = f"{'a' * 32}:entry:1"
        self.assertEqual(
            knowledge_entry_path(entry_id, "feedback"),
            f"/digital-twin/journal/{entry_id}/feedback",
        )
        with self.assertRaises(HTTPException):
            knowledge_entry_path("invalid", "feedback")


class TaskNarrationTest(unittest.IsolatedAsyncioTestCase):
    async def test_summarizer_gets_only_owner_scoped_progress(self):
        calls = []

        async def gateway(_request, method, path, *, query=None):
            calls.append((method, path, query))
            if path.endswith("/progress"):
                return [
                    {"id": 1, "spoken": "The agent has started working."},
                    {"id": 2, "spoken": "The agent is reading README.md."},
                    {"id": 3, "spoken": "The agent is running a workspace command."},
                    {"id": 4, "spoken": "The agent is running: git diff."},
                ]
            return {"instruction": "Review the pull request"}

        async def narrator(task_id, instruction, events):
            calls.append((task_id, instruction, events))
            return "The agent is reading the project guidance and reviewing the changes."

        with (
            patch("bot.owner_gateway_request", gateway),
            patch("bot.broker_task_narration", narrator),
        ):
            spoken = await summarize_owned_task_progress(
                request("POST", identity="owner@example.com"), "task-1", 0, 4
            )

        self.assertIn("reviewing the changes", spoken)
        self.assertEqual(calls[0], ("GET", "/tasks/task-1", None))
        self.assertEqual(calls[1], ("GET", "/tasks/task-1/progress", {"after": 0}))
        self.assertEqual(calls[2][2], [
            "The agent is reading README.md.",
            "The agent is running: git diff.",
        ])

    async def test_summarizer_rejects_missing_end_cursor(self):
        async def gateway(_request, _method, path, *, query=None):
            return [] if path.endswith("/progress") else {"instruction": "Review"}

        with patch("bot.owner_gateway_request", gateway):
            with self.assertRaises(HTTPException) as raised:
                await summarize_owned_task_progress(
                    request("POST", identity="owner@example.com"), "task-1", 0, 3
                )
        self.assertEqual(raised.exception.status_code, 409)


def request(
    method: str,
    *,
    origin: str | None = None,
    identity: str | None = None,
    local_ingress: bool = False,
) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if origin is not None:
        headers.append((b"origin", origin.encode()))
    if identity is not None:
        headers.append((b"tailscale-user-login", identity.encode()))
    if local_ingress:
        headers.append((b"x-voice-local-ingress", b"1"))
    return Request({"type": "http", "method": method, "headers": headers})


class HttpIdentityTest(unittest.TestCase):
    def setUp(self) -> None:
        self.environment = patch.dict(
            os.environ,
            {
                "EDGE_ALLOWED_USERS": "owner@example.com",
                "PIPECAT_ALLOWED_ORIGINS": "https://voice.example.test",
            },
        )
        self.environment.start()

    def tearDown(self) -> None:
        self.environment.stop()

    def test_same_origin_get_without_origin_header_keeps_tailnet_identity_check(self):
        identity = validate_http_identity(
            request("GET", identity="OWNER@example.com")
        )

        self.assertEqual(identity, "owner@example.com")

    def test_get_rejects_an_explicit_foreign_origin(self):
        with self.assertRaises(HTTPException) as raised:
            validate_http_identity(
                request(
                    "GET",
                    origin="https://attacker.example",
                    identity="owner@example.com",
                )
            )

        self.assertEqual(raised.exception.status_code, 403)

    def test_trace_proxy_rejects_path_traversal(self):
        with (
            patch.dict(
                os.environ,
                {"PLAYWRIGHT_TRACE_VIEWER_INTERNAL_BASE_URL": "http://viewer.test:9450"},
            ),
            self.assertRaises(HTTPException) as raised,
        ):
            playwright_trace_upstream("trace-viewer/../secret")

        self.assertEqual(raised.exception.status_code, 400)

class PlaywrightTraceProxyTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.environment = patch.dict(
            os.environ,
            {
                "EDGE_ALLOWED_USERS": "owner@example.com",
                "PIPECAT_ALLOWED_ORIGINS": "https://voice.example.test",
            },
        )
        self.environment.start()

    def tearDown(self) -> None:
        self.environment.stop()

    async def test_task_artifact_proxy_forwards_owner_identity_and_attachment(self):
        observed = {}

        async def handler(upstream_request: httpx.Request) -> httpx.Response:
            observed["url"] = str(upstream_request.url)
            observed["authorization"] = upstream_request.headers.get("authorization")
            return httpx.Response(
                200,
                headers={
                    "Content-Type": "application/zip",
                    "Content-Disposition": 'attachment; filename="workspace.zip"',
                },
                content=b"zip",
            )

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        with (
            patch.dict(
                os.environ,
                {
                    "AGENT_GATEWAY_BASE_URL": "http://gateway.test/v1",
                    "AGENT_GATEWAY_TOKEN": "g" * 32,
                },
            ),
            patch("bot.httpx.AsyncClient", return_value=client),
        ):
            content, content_type, disposition = await owner_gateway_artifact(
                request("GET", identity="owner@example.com"),
                "11111111-1111-4111-8111-111111111111",
                "workspace",
            )

        self.assertEqual(content, b"zip")
        self.assertEqual(content_type, "application/zip")
        self.assertEqual(disposition, 'attachment; filename="workspace.zip"')
        self.assertEqual(observed["authorization"], "Bearer " + "g" * 32)
        self.assertEqual(
            observed["url"],
            "http://gateway.test/v1/tasks/11111111-1111-4111-8111-111111111111/artifacts/workspace?identity=owner%40example.com",
        )

    async def test_proxy_streams_a_ranged_trace_from_the_host_service(self):
        observed: dict[str, str] = {}

        async def handler(upstream_request: httpx.Request) -> httpx.Response:
            observed["url"] = str(upstream_request.url)
            observed["range"] = upstream_request.headers.get("range", "")
            return httpx.Response(
                206,
                headers={
                    "Accept-Ranges": "bytes",
                    "Content-Range": "bytes 0-2/3",
                    "Content-Type": "application/zip",
                },
                stream=httpx.ByteStream(b"zip"),
            )

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        trace_request = Request(
            {
                "type": "http",
                "method": "GET",
                "headers": [
                    (b"tailscale-user-login", b"owner@example.com"),
                    (b"range", b"bytes=0-2"),
                ],
            }
        )
        with (
            patch.dict(
                os.environ,
                {
                    "EDGE_ALLOWED_USERS": "owner@example.com",
                    "PIPECAT_ALLOWED_ORIGINS": "https://voice.example.test",
                    "PLAYWRIGHT_TRACE_VIEWER_INTERNAL_BASE_URL": "http://viewer.test:9450",
                },
            ),
            patch("bot.httpx.AsyncClient", return_value=client),
        ):
            response = await proxy_playwright_trace(
                trace_request,
                "api/playwright-traces/0123456789abcdef0123456789abcdef/trace.zip",
            )
            body = b"".join([
                chunk.encode() if isinstance(chunk, str) else bytes(chunk)
                async for chunk in response.body_iterator
            ])
            if response.background is not None:
                await response.background()

        self.assertEqual(response.status_code, 206)
        self.assertEqual(body, b"zip")
        self.assertEqual(observed["range"], "bytes=0-2")
        self.assertEqual(
            observed["url"],
            "http://viewer.test:9450/api/playwright-traces/"
            "0123456789abcdef0123456789abcdef/trace.zip",
        )

    def test_state_changing_request_requires_an_allowed_origin(self):
        with self.assertRaises(HTTPException) as raised:
            validate_http_identity(request("POST", identity="owner@example.com"))

        self.assertEqual(raised.exception.status_code, 403)

    def test_safe_request_still_requires_tailnet_identity(self):
        with self.assertRaises(HTTPException) as raised:
            validate_http_identity(request("GET"))

        self.assertEqual(raised.exception.status_code, 403)

    def test_local_ingress_resolves_the_single_owner_when_enabled(self):
        with patch.dict(
            os.environ,
            {
                "EDGE_ALLOW_LOCAL_INGRESS": "true",
                "EDGE_LOCAL_ORIGINS": "http://127.0.0.1:8080,http://localhost:8080",
            },
        ):
            identity = validate_http_identity(
                request(
                    "POST",
                    origin="http://127.0.0.1:8080",
                    local_ingress=True,
                )
            )

        self.assertEqual(identity, "owner@example.com")

    def test_local_marker_is_rejected_when_local_ingress_is_disabled(self):
        with self.assertRaises(HTTPException) as raised:
            validate_http_identity(request("GET", local_ingress=True))

        self.assertEqual(raised.exception.status_code, 403)

    def test_local_ingress_rejects_unlisted_browser_origin(self):
        with (
            patch.dict(os.environ, {"EDGE_ALLOW_LOCAL_INGRESS": "true"}),
            self.assertRaises(HTTPException) as raised,
        ):
            validate_http_identity(
                request(
                    "POST",
                    origin="http://attacker.example",
                    local_ingress=True,
                )
            )

        self.assertEqual(raised.exception.status_code, 403)

    def test_ingress_forward_auth_requires_the_exact_owner(self):
        self.assertEqual(
            validate_ingress_identity(request("GET", identity="OWNER@example.com")),
            "owner@example.com",
        )
        with self.assertRaises(HTTPException) as raised:
            validate_ingress_identity(request("GET", identity="other@example.com"))

        self.assertEqual(raised.exception.status_code, 403)


class SessionTelemetryTest(unittest.IsolatedAsyncioTestCase):
    async def test_new_session_observes_the_edge_to_broker_hop(self):
        operations: list[str] = []

        @contextmanager
        def observe(operation: str):
            operations.append(operation)
            yield

        class Client:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return None

            async def request(self, method: str, url: str, **kwargs):
                request = httpx.Request(method, url)
                return httpx.Response(
                    201,
                    request=request,
                    json={"activeSessionId": "fresh-session"},
                )

        with (
            patch.dict(
                os.environ,
                {
                    "INFERENCE_BROKER_TOKEN": "x" * 32,
                    "INFERENCE_BROKER_BASE_URL": "http://broker.test/v1",
                },
            ),
            patch("bot.httpx.AsyncClient", Client),
            patch("bot.telemetry", SimpleNamespace(observe=observe)),
        ):
            payload = await broker_sessions_request(
                "/new",
                "POST",
                operation="browser.pi.sessions.new",
            )

        self.assertEqual(payload["activeSessionId"], "fresh-session")
        self.assertEqual(operations, ["browser.pi.sessions.new"])

    async def test_resume_session_observes_the_edge_to_broker_hop(self):
        operations: list[str] = []

        @contextmanager
        def observe(operation: str):
            operations.append(operation)
            yield

        class Client:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return None

            async def request(self, method: str, url: str, **kwargs):
                request = httpx.Request(method, url)
                return httpx.Response(
                    200,
                    request=request,
                    json={"id": "persisted-session"},
                )

        with (
            patch.dict(
                os.environ,
                {
                    "INFERENCE_BROKER_TOKEN": "x" * 32,
                    "INFERENCE_BROKER_BASE_URL": "http://broker.test/v1",
                },
            ),
            patch("bot.httpx.AsyncClient", Client),
            patch("bot.telemetry", SimpleNamespace(observe=observe)),
        ):
            payload = await broker_sessions_request(
                "/persisted-session/resume",
                "POST",
                operation="browser.pi.sessions.resume",
            )

        self.assertEqual(payload["id"], "persisted-session")
        self.assertEqual(operations, ["browser.pi.sessions.resume"])


class GatewayTracePropagationTest(unittest.IsolatedAsyncioTestCase):
    async def test_owner_gateway_request_propagates_the_active_trace_context(self):
        observed_headers: dict[str, str] = {}

        async def handler(upstream_request: httpx.Request) -> httpx.Response:
            observed_headers.update(upstream_request.headers)
            return httpx.Response(200, request=upstream_request, json=[])

        @contextmanager
        def observe(_operation: str):
            yield

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        span_context = SpanContext(
            trace_id=int("1234567890abcdef1234567890abcdef", 16),
            span_id=int("1234567890abcdef", 16),
            is_remote=False,
            trace_flags=TraceFlags(TraceFlags.SAMPLED),
        )
        token = attach(set_span_in_context(NonRecordingSpan(span_context)))
        try:
            with (
                patch.dict(
                    os.environ,
                    {
                        "AGENT_GATEWAY_BASE_URL": "http://gateway.test/v1",
                        "AGENT_GATEWAY_TOKEN": "x" * 32,
                        "EDGE_ALLOWED_USERS": "owner@example.com",
                        "PIPECAT_ALLOWED_ORIGINS": "https://voice.example.test",
                    },
                ),
                patch("bot.httpx.AsyncClient", return_value=client),
                patch("bot.telemetry", SimpleNamespace(observe=observe)),
            ):
                await owner_gateway_request(
                    request("GET", identity="owner@example.com"),
                    "GET",
                    "/tasks",
                )
        finally:
            detach(token)

        self.assertEqual(
            observed_headers["traceparent"],
            "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01",
        )

    async def test_song_audio_proxy_keeps_gateway_token_out_of_the_browser(self):
        observed_url = ""

        async def handler(upstream_request: httpx.Request) -> httpx.Response:
            nonlocal observed_url
            observed_url = str(upstream_request.url)
            self.assertEqual(upstream_request.headers["authorization"], f"Bearer {'x' * 32}")
            return httpx.Response(
                200,
                request=upstream_request,
                content=b"m4a-audio",
                headers={"Content-Type": "audio/mp4"},
            )

        @contextmanager
        def observe(_operation: str):
            yield

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        with (
            patch.dict(
                os.environ,
                {
                    "AGENT_GATEWAY_BASE_URL": "http://gateway.test/v1",
                    "AGENT_GATEWAY_TOKEN": "x" * 32,
                    "EDGE_ALLOWED_USERS": "owner@example.com",
                    "PIPECAT_ALLOWED_ORIGINS": "https://voice.example.test",
                },
            ),
            patch("bot.httpx.AsyncClient", return_value=client),
            patch("bot.telemetry", SimpleNamespace(observe=observe)),
        ):
            audio = await owner_gateway_audio(
                request("GET", identity="owner@example.com"),
                "00000000-0000-0000-0000-000000000001",
            )

        self.assertEqual(audio, b"m4a-audio")
        self.assertIn("identity=owner%40example.com", observed_url)


if __name__ == "__main__":
    unittest.main()
