import assert from "node:assert/strict";
import test from "node:test";

import { compileDashboard, escapePrometheusLabel } from "./c4-dashboard.mjs";

const input = {
  options: {
    "dashboard-title": "Voice Architecture",
    "dashboard-uid": "voice-c4-test",
    description: "Generated test dashboard",
    refresh: "10s",
    "time-from": "now-15m",
    "evidence-markdown": "## Evidence",
  },
  diagrams: [
    { id: "context", title: "C1", mermaid: "C4Context\nSystem(system, \"System\", \"Test\")", width: 12, height: 14 },
    { id: "deployment", title: "Deployment", mermaid: "flowchart LR\nEDGE[Edge] --> OTEL[OTel]", width: 12, height: 14 },
  ],
  evidence: [
    { "diagram-id": "context", "element-id": "system", status: "strong" },
    { "diagram-id": "deployment", "element-id": "EDGE", status: "partial" },
  ],
  activity: [{ "diagram-id": "deployment", "element-id": "EDGE", "ref-id": "A", "service-name": "voice-edge" }],
};

test("compiles deterministic C4 panels and PromQL overlays", () => {
  const dashboard = compileDashboard(input);
  assert.equal(dashboard.title, "Voice Architecture");
  assert.equal(dashboard.panels.length, 3);
  assert.match(dashboard.panels[1].options.content, /UpdateElementStyle\(system/);
  assert.match(dashboard.panels[2].options.content, /style EDGE fill:\$\{__data\.A:color\}/);
  assert.match(dashboard.panels[2].targets[0].expr, /service_name="voice-edge"/);
  assert.deepEqual(dashboard.tags, ["c4", "architecture", "evidence", "prometheus", "grafana-mcp"]);
});

test("rejects invalid and duplicate query references", () => {
  assert.throws(
    () => compileDashboard({ ...input, activity: [{ ...input.activity[0], "ref-id": "voice_edge" }] }),
    /expected one uppercase letter/,
  );
  assert.throws(
    () => compileDashboard({ ...input, activity: [input.activity[0], { ...input.activity[0], "element-id": "OTEL" }] }),
    /duplicate query reference/,
  );
});

test("escapes Prometheus label values", () => {
  assert.equal(escapePrometheusLabel('service\\"name'), 'service\\\\\\"name');
});
