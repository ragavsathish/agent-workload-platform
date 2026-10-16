#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const productRoot = resolve(here, "..", "..");
const architecture = join(productRoot, "docs", "architecture");
const output = join(here, "c4-heatmap.json");
const component = resolve(
  process.env.C4_GRAFANA_WASM ?? join(productRoot, "components", "c4-grafana-ts", "dist", "c4-grafana.wasm"),
);
const wassette = process.env.WASSETTE_BIN ?? join(process.env.HOME ?? "", ".local", "bin", "wassette");

const evidence = {
  "c1-system-context": { voice_agent: "partial" },
  "c2-container": {
    BROWSER: "strong", DIAGNOSTICS: "partial", INGRESS: "strong", ROUTER: "strong",
    EDGE: "strong", BROKER: "partial", PI: "partial", VOICE_VM: "partial",
    GATEWAY: "partial", TASKS: "observed", HABITAT: "observed", WORKER: "weak",
    TASK_PI: "weak", TASK_VM: "partial", WASSETTE: "partial",
    BUILDER_MANAGER: "weak", BUILDER_VM: "weak", VOICE_DATA: "partial",
    GITEA: "partial", ARTIFACTS: "partial", DOCKER_METRICS: "strong",
    HOST_METRICS: "strong", OTEL: "strong",
  },
  "c3-browser-client": { BROWSER: "strong" },
  "c3-input-diagnostics": { DIAGNOSTICS: "partial" },
  "c3-voice-edge": { EDGE: "strong" },
  "c3-inference-broker": { BROKER: "partial" },
  "c3-pi-voice-service": { PI: "partial" },
  "c3-voice-tool-sandbox": { VM: "partial" },
  "c3-agent-gateway": { GATEWAY: "partial" },
  "c3-pi-task-worker": { WORKER: "weak" },
  "c3-image-build-worker": { WORKER: "weak" },
  "c3-disposable-image-builder": { HOST: "weak" },
  "c3-task-tool-runtime": { RUNTIME: "partial" },
  "c3-host-observability": { OBS: "strong" },
  "deployment-security": {
    EDGE: "strong", GATEWAY: "partial", BROKER: "partial", PI: "partial",
    VOICE_TOOLS: "partial", WORKER: "weak", TASK_PI: "weak", TASK_TOOLS: "partial",
    VOICE_WASSETTE: "partial", TASK_WASSETTE: "partial", BUILDER_MANAGER: "weak",
    RUNNER: "weak", DOCKERD: "weak", POSTGRES: "observed", HABITAT: "observed",
    S3: "partial", GITEA: "partial", DOCKER_METRICS: "strong",
    HOST_METRICS: "strong", OTEL: "strong",
  },
};

// Grafana query references are local to a panel and must be A-Z. Service names
// stay in the PromQL label selector rather than being overloaded as references.
const activity = {
  "c1-system-context": { voice_agent: ["A", "*"] },
  "c2-container": {
    EDGE: ["A", "pipecat-voice-edge"],
    BROKER: ["B", "pipecat-mlx-inference"],
    GATEWAY: ["C", "pipecat-agent-gateway"],
    PI: ["D", "pipecat-pi-voice"],
    WORKER: ["E", "pipecat-task-worker"],
    BUILDER_MANAGER: ["F", "pipecat-image-builder"],
    BUILDER_VM: ["G", "pipecat-gitea-runner"],
    OTEL: ["H", "*"],
  },
  "c3-voice-edge": { EDGE: ["A", "pipecat-voice-edge"] },
  "c3-inference-broker": { BROKER: ["A", "pipecat-mlx-inference"] },
  "c3-pi-voice-service": { PI: ["A", "pipecat-pi-voice"] },
  "c3-agent-gateway": { GATEWAY: ["A", "pipecat-agent-gateway"] },
  "c3-pi-task-worker": { WORKER: ["A", "pipecat-task-worker"] },
  "c3-image-build-worker": { WORKER: ["A", "pipecat-task-worker"] },
  "c3-disposable-image-builder": {
    MANAGER: ["A", "pipecat-image-builder"],
    RUNNER: ["B", "pipecat-gitea-runner"],
    OTEL: ["C", "*"],
  },
  "deployment-security": {
    EDGE: ["A", "pipecat-voice-edge"],
    BROKER: ["B", "pipecat-mlx-inference"],
    GATEWAY: ["C", "pipecat-agent-gateway"],
    PI: ["D", "pipecat-pi-voice"],
    WORKER: ["E", "pipecat-task-worker"],
    BUILDER_MANAGER: ["F", "pipecat-image-builder"],
    RUNNER: ["G", "pipecat-gitea-runner"],
    OTEL: ["H", "*"],
  },
};

const views = [
  ["c1-system-context", "C1 · System context"],
  ["c2-container", "C2 · Containers"],
  ["c3-browser-client", "C3 · Browser Voice Client"],
  ["c3-input-diagnostics", "C3 · Input Diagnostics"],
  ["c3-voice-edge", "C3 · Voice Edge"],
  ["c3-inference-broker", "C3 · Inference Broker"],
  ["c3-pi-voice-service", "C3 · Pi Voice Service"],
  ["c3-voice-tool-sandbox", "C3 · Voice Tool Sandbox"],
  ["c3-agent-gateway", "C3 · Agent Gateway"],
  ["c3-pi-task-worker", "C3 · Pi Task Worker"],
  ["c3-image-build-worker", "C3 · Image Build Orchestration"],
  ["c3-disposable-image-builder", "C3 · Shared Image Builder"],
  ["c3-task-tool-runtime", "C3 · Pi Task Session"],
  ["c3-host-observability", "C3 · Host Observability"],
  ["deployment-security", "Deployment · Security boundaries"],
];

const diagrams = views.map(([id, title]) => {
  const isOverview = id === "c1-system-context" || id === "c2-container" || id === "deployment-security";
  return {
    id,
    title,
    mermaid: readFileSync(join(architecture, `${id}.mmd`), "utf8"),
    width: isOverview ? 24 : 12,
    height: id === "c2-container" || id === "deployment-security" ? 22 : 14,
  };
});

const evidenceStyles = Object.entries(evidence).flatMap(([diagramId, elements]) =>
  Object.entries(elements).map(([elementId, status]) => ({
    "diagram-id": diagramId,
    "element-id": elementId,
    status,
  })),
);

const activityOverlays = Object.entries(activity).flatMap(([diagramId, elements]) =>
  Object.entries(elements).map(([elementId, [refId, serviceName]]) => ({
    "diagram-id": diagramId,
    "element-id": elementId,
    "ref-id": refId,
    "service-name": serviceName,
  })),
);

const args = {
  options: {
    "dashboard-title": "C4 Operational Heat Map",
    "dashboard-uid": "voice-c4-heatmap",
    description: "Generated from the authoritative Voice Agent Mermaid C4 sources with source-backed evidence and live Prometheus activity overlays.",
    refresh: "10s",
    "time-from": "now-15m",
    "evidence-markdown": "## Engineering evidence\n\n| Executable surface | Line coverage |\n|---|---:|\n| Flutter client | **63.9%** |\n| Pi Voice Service | **36.4%** |\n| Gondolin workspace adapter | **53.4%** |\n| Combined Pi agent JavaScript | **40.3%** |\n\nBuild evidence snapshot · 2026-10-16. Other surfaces have test evidence but no consolidated executable-line report.\n\n## How to read this dashboard\n\n- 🟢 **Strong** — broad automated evidence\n- 🟠 **Partial** — meaningful evidence with known gaps\n- 🔵 **Observed** — runtime or dependency evidence only\n- 🔴 **Weak** — important gap\n\nLive PromQL activity overrides the fill intensity for instrumented nodes. Architecture and evidence remain source-controlled; operations remain live in Grafana.",
  },
  diagrams,
  evidence: evidenceStyles,
  activity: activityOverlays,
};

function runWassette(parameters) {
  const result = spawnSync(wassette, parameters, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Wassette exited ${result.status}: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

statSync(component);
statSync(wassette);
const componentDirectory = mkdtempSync(join(tmpdir(), "voice-c4-grafana-"));
try {
  runWassette([
    "component", "load",
    "--component-dir", componentDirectory,
    pathToFileURL(component).href,
  ]);
  const response = JSON.parse(runWassette([
    "tool", "invoke",
    "--component-dir", componentDirectory,
    "compile-dashboard",
    "--args", JSON.stringify(args),
  ]));
  const result = response.result ?? response;
  if (typeof result.err === "string") throw new Error(`C4 Grafana component rejected input: ${result.err}`);
  if (typeof result.ok !== "string") throw new Error("C4 Grafana component returned no dashboard JSON");
  const dashboard = JSON.parse(result.ok);
  if (dashboard.uid !== args.options["dashboard-uid"] || dashboard.panels.length !== views.length + 1) {
    throw new Error("C4 Grafana component returned an unexpected dashboard structure");
  }
  writeFileSync(output, `${JSON.stringify(dashboard, null, 2)}\n`);
  console.log(`Generated ${output} with ${dashboard.panels.length} panels through ${component}`);
} finally {
  rmSync(componentDirectory, { force: true, recursive: true });
}
