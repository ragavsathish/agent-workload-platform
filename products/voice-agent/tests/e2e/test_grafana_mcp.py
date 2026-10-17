import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("grafana-mcp.py")
SPEC = importlib.util.spec_from_file_location("grafana_mcp_regression", SCRIPT)
assert SPEC and SPEC.loader
GRAFANA_MCP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GRAFANA_MCP)


class FreshTraceSelectionTest(unittest.TestCase):
    def test_ignores_traces_from_before_the_regression_run(self) -> None:
        traces = [
            {"traceID": "stale", "startTimeUnixNano": "999"},
            {"traceID": "fresh", "startTimeUnixNano": "1001"},
        ]

        trace = GRAFANA_MCP.first_trace_at_or_after(traces, 1000)

        self.assertEqual(trace["traceID"], "fresh")

    def test_ignores_missing_or_invalid_timestamps(self) -> None:
        traces = [
            {"traceID": "missing"},
            {"traceID": "invalid", "startTimeUnixNano": "not-a-number"},
        ]

        self.assertIsNone(GRAFANA_MCP.first_trace_at_or_after(traces, 1000))


if __name__ == "__main__":
    unittest.main()
