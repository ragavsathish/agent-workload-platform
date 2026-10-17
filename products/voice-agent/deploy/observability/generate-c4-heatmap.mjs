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
    BUILDER_MANAGER: "strong", BUILDER_VM: "strong", VOICE_DATA: "partial",
    GITEA: "partial", ARTIFACTS: "partial", OXIGRAPH: "observed", DOCKER_METRICS: "strong",
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
  "c3-disposable-image-builder": { MANAGER: "strong", RUNNER: "strong", OTEL: "strong" },
  "c3-task-tool-runtime": { RUNTIME: "partial" },
  "c3-host-observability": { OBS: "strong" },
  "deployment-security": {
    EDGE: "strong", GATEWAY: "partial", BROKER: "partial", PI: "partial",
    VOICE_TOOLS: "partial", WORKER: "weak", TASK_PI: "weak", TASK_TOOLS: "partial",
    VOICE_WASSETTE: "partial", TASK_WASSETTE: "partial", BUILDER_MANAGER: "strong",
    RUNNER: "strong", DOCKERD: "weak", POSTGRES: "observed", HABITAT: "observed",
    S3: "partial", GITEA: "partial", OXIGRAPH: "observed", DOCKER_METRICS: "strong",
    HOST_METRICS: "strong", OTEL: "strong",
  },
};

// Grafana query references are local to a panel and must be A-Z. Service names
// stay in the PromQL label selector rather than being overloaded as references.
const activity = {
  "c2-container": {
    EDGE: ["A", "pipecat-voice-edge"],
    BROKER: ["B", "pipecat-mlx-inference"],
    GATEWAY: ["C", "pipecat-agent-gateway"],
    PI: ["D", "pipecat-pi-voice"],
    WORKER: ["E", "pipecat-task-worker"],
    BUILDER_MANAGER: ["F", "pipecat-image-builder"],
    BUILDER_VM: ["G", "pipecat-gitea-runner"],
  },
};

const neutralDarkFill = "#3f3f46";
const neutralLightFill = "#d4d4d8";
const neutralText = "#f4f4f5";

function neutralizeDiagram(source) {
  if (/^\s*C4(?:Context|Container|Component|Dynamic|Deployment)\b/mu.test(source)) {
    const elementIds = [...source.matchAll(
      /^\s*(?:Person|Person_Ext|System|System_Ext|SystemDb|SystemDb_Ext|Container|ContainerDb|ContainerQueue|Component)\(\s*([A-Za-z][A-Za-z0-9_-]*)\s*,/gmu,
    )].map((match) => match[1]);
    const styles = elementIds.map((elementId) => (
      `UpdateElementStyle(${elementId}, "${neutralDarkFill}", "${neutralText}")`
    ));
    return `${source.trim()}\n\n%% Grafana node backgrounds are intentionally neutral.\n${styles.join("\n")}\n`;
  }

  return source.replace(/^\s*classDef\s+[^\n]+$/gmu, (definition) => {
    const [, rawFill] = definition.match(/fill:\s*#([0-9a-f]{3}|[0-9a-f]{6})\b/iu) ?? [];
    if (!rawFill) return definition;
    const expandedFill = rawFill.length === 3
      ? [...rawFill].map((part) => `${part}${part}`).join("")
      : rawFill;
    const channels = expandedFill.match(/.{2}/gu).map((part) => Number.parseInt(part, 16));
    const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    return definition.replace(
      /fill:\s*#[0-9a-f]{3,8}/iu,
      `fill:${luminance < 145 ? neutralDarkFill : neutralLightFill}`,
    );
  });
}

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
    mermaid: neutralizeDiagram(readFileSync(join(architecture, `${id}.mmd`), "utf8")),
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
    description: "Generated from the authoritative Voice Agent Mermaid C4 sources. The C2 container view carries live Prometheus activity overlays; detail views stay neutral gray.",
    refresh: "30s",
    "time-from": "now-15m",
    "evidence-markdown": "## Engineering evidence\n\n| Executable surface | Line coverage |\n|---|---:|\n| Flutter client | **63.9%** |\n| Pi Voice Service | **36.4%** |\n| Gondolin workspace adapter | **53.4%** |\n| Combined Pi agent JavaScript | **40.3%** |\n\nBuild evidence snapshot · 2026-10-16. Other surfaces have test evidence but no consolidated executable-line report.\n\n## How to read this dashboard\n\n**C2 fill = telemetry activity:** 🔴 missing or stale for 2 minutes · ⚪ idle · 🔵 low · 🟦 medium · 🟢 high. Activity is volume, not health.\n\n**C2 border = evidence:** 🟢 strong · 🟠 partial · 🔵 observed · 🔴 weak. All other views use neutral gray backgrounds so the live container trace remains the sole highlight.\n\nArchitecture and evidence remain source-controlled; operations remain live in Grafana. Use the dashboard links for RED product signals and USE resource signals.",
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
