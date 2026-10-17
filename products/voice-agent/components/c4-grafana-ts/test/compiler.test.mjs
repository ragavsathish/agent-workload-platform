import assert from "node:assert/strict";
import test from "node:test";

import { compileDashboard, testing } from "../build/index.js";

const options = {
  dashboardTitle: "Voice Architecture",
  dashboardUid: "voice-c4-test",
  description: "Generated test dashboard",
  refresh: "10s",
  timeFrom: "now-15m",
  evidenceMarkdown: "## Evidence\n\nGenerated in a deterministic test.",
};

const diagrams = [
  {
    id: "context",
    title: "C1 · Context",
    mermaid: "C4Context\ntitle Test\nSystem(system, \"System\", \"Test\")",
    width: 12,
    height: 14,
  },
  {
    id: "deployment",
    title: "Deployment",
    mermaid: "flowchart LR\nEDGE[Edge] --> OTEL[OTel]",
    width: 12,
    height: 14,
  },
];

function assertComponentError(action, expected) {
  try {
    action();
    assert.fail("expected component error");
  } catch (error) {
    assert.equal(error, expected);
  }
}

test("compiles C4 sources into deterministic Grafana JSON", () => {
  const result = compileDashboard(
    options,
    diagrams,
    [
      { diagramId: "context", elementId: "system", status: "strong" },
      { diagramId: "deployment", elementId: "EDGE", status: "partial" },
    ],
    [{ diagramId: "deployment", elementId: "EDGE", refId: "A", serviceName: "voice-edge" }],
  );
  const dashboard = JSON.parse(result);
  assert.equal(dashboard.title, "Voice Architecture");
  assert.equal(dashboard.panels.length, 3);
  assert.deepEqual(dashboard.panels[1].gridPos, { h: 14, w: 12, x: 0, y: 8 });
  assert.deepEqual(dashboard.panels[2].gridPos, { h: 14, w: 12, x: 12, y: 8 });
  assert.match(
    dashboard.panels[1].options.content,
    /UpdateElementStyle\(system, "#3f3f46", "#f4f4f5", "#56e39f"\)/,
  );
  assert.match(
    dashboard.panels[2].options.content,
    /style EDGE fill:\$\{__data\.A:color\},color:#07130d,stroke:#ffbd76,stroke-width:5px/,
  );
  assert.equal(
    dashboard.panels[2].targets[0].expr,
    '(sum(increase(pipecat_operation_total{service_name="voice-edge"}[$__range])) and on() (max(timestamp(pipecat_operation_total{service_name="voice-edge"})) > time() - 120)) or vector(-1)',
  );
  assert.deepEqual(
    dashboard.panels[2].fieldConfig.defaults.thresholds.steps.slice(0, 3),
    [
      { color: "#ff778a", value: null },
      { color: "#94a3b8", value: 0 },
      { color: "#38bdf8", value: 1 },
    ],
  );
  assert.equal(dashboard.links.length, 2);
  assert.equal(dashboard.annotations.list[0].name, "Deployments and E2E runs");
  assert.equal(dashboard.panels[1].description, 'No live activity overlay is applied to this architecture detail view.');
  assert.match(dashboard.panels[2].description, /Fill shows live PromQL activity/);
  assert.equal(dashboard.version, 12);
});

test("rejects references to diagrams that were not supplied", () => {
  assertComponentError(
    () => compileDashboard(
      options,
      diagrams,
      [{ diagramId: "missing", elementId: "EDGE", status: "strong" }],
      [],
    ),
    "evidence references unknown diagram: missing",
  );
});

test("uses the Gitea runner's native health metric for its activity overlay", () => {
  const dashboard = JSON.parse(compileDashboard(
    options,
    diagrams,
    [],
    [{
      diagramId: "deployment",
      elementId: "EDGE",
      refId: "A",
      serviceName: "pipecat-gitea-runner",
    }],
  ));
  assert.equal(
    dashboard.panels[2].targets[0].expr,
    '(sum(gitea_runner_info{service_name="pipecat-gitea-runner"}) and on() (max(timestamp(gitea_runner_info{service_name="pipecat-gitea-runner"})) > time() - 120)) or vector(-1)',
  );
});

test("rejects descriptive Grafana query references without trapping", () => {
  assertComponentError(
    () => compileDashboard(
      options,
      diagrams,
      [],
      [{ diagramId: "deployment", elementId: "EDGE", refId: "voice_edge", serviceName: "voice-edge" }],
    ),
    "invalid activity ref-id: voice_edge; expected one uppercase letter from A through Z",
  );
});

test("rejects duplicate query references within one diagram", () => {
  assertComponentError(
    () => compileDashboard(
      options,
      diagrams,
      [],
      [
        { diagramId: "deployment", elementId: "EDGE", refId: "A", serviceName: "voice-edge" },
        { diagramId: "deployment", elementId: "OTEL", refId: "A", serviceName: "otel-collector" },
      ],
    ),
    "duplicate query reference A in deployment",
  );
});

test("escapes Prometheus label values", () => {
  assert.equal(testing.escapePrometheusLabel('service\\\"name'), 'service\\\\\\"name');
});
