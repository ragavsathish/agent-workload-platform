import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException, Request

from bot import validate_http_identity


def request(method: str, *, origin: str | None = None, identity: str | None = None) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if origin is not None:
        headers.append((b"origin", origin.encode()))
    if identity is not None:
        headers.append((b"tailscale-user-login", identity.encode()))
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

    def test_state_changing_request_requires_an_allowed_origin(self):
        with self.assertRaises(HTTPException) as raised:
            validate_http_identity(request("POST", identity="owner@example.com"))

        self.assertEqual(raised.exception.status_code, 403)

    def test_safe_request_still_requires_tailnet_identity(self):
        with self.assertRaises(HTTPException) as raised:
            validate_http_identity(request("GET"))

        self.assertEqual(raised.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
