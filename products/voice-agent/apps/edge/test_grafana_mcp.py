import json
import unittest

import httpx

from grafana_mcp import decode_mcp_response


class GrafanaMcpResponseTest(unittest.TestCase):
    def test_decodes_json_response(self):
        response = httpx.Response(
            200,
            headers={"content-type": "application/json"},
            content=json.dumps({"jsonrpc": "2.0", "result": {"ok": True}}),
        )
        self.assertEqual(decode_mcp_response(response)["result"], {"ok": True})

    def test_decodes_streamable_http_event(self):
        response = httpx.Response(
            200,
            headers={"content-type": "text/event-stream; charset=utf-8"},
            content='event: message\ndata: {"jsonrpc":"2.0","result":{"ok":true}}\n\n',
        )
        self.assertEqual(decode_mcp_response(response)["result"], {"ok": True})

    def test_rejects_empty_event_stream(self):
        response = httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content="event: ping\n\n",
        )
        with self.assertRaisesRegex(RuntimeError, "empty event stream"):
            decode_mcp_response(response)


if __name__ == "__main__":
    unittest.main()
