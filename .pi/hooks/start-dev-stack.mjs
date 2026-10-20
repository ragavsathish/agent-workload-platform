#!/usr/bin/env node

// Pi's session_start runs this inside the disposable development VM, after dockerd.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import { randomBytes } from "node:crypto";

const cache = "/image-cache";
const baseComposeFile = "/workspace/products/voice-agent/deploy/compose.yml";
const devComposeFile = "/workspace/.pi/compose.dev.yml";
const fullComposeFile = "/workspace/.pi/compose.full-mock.yml";
const fullStack = process.env.GONDOLIN_COMPOSE_PROFILE === "full-mock";

if (!fs.existsSync(`${cache}/index.json`)) {
  console.log("dev Compose skipped: shared image cache is not mounted");
  process.exit(0);
}

const index = JSON.parse(fs.readFileSync(`${cache}/index.json`, "utf8"));
const secretDirectory = "/var/lib/gondolin-full-mock-secrets";
const ensureSecret = (name, value) => {
  const file = `${secretDirectory}/${name}`;
  if (!fs.existsSync(file)) fs.writeFileSync(file, `${value}\n`, { mode: 0o644, flag: "wx" });
  fs.chmodSync(file, 0o644);
  return fs.readFileSync(file, "utf8").trim();
};
let mockBrokerToken;
const readSecret = (name) => fs.readFileSync(`${secretDirectory}/${name}`, "utf8").trim();
if (fullStack) {
  fs.mkdirSync(secretDirectory, { recursive: true, mode: 0o755 });
  fs.chmodSync(secretDirectory, 0o755);
  for (const script of ["bootstrap-grafana-mcp.sh", "run-grafana-mcp.sh"]) {
    const source = fs.readFileSync(`/workspace/products/voice-agent/deploy/observability/${script}`, "utf8");
    const content = script === "run-grafana-mcp.sh"
      ? source.replace("--metrics-address 0.0.0.0:9090", "--metrics-address 127.0.0.1:9910")
      : source;
    fs.writeFileSync(`${secretDirectory}/${script}`, content, { mode: 0o644 });
    fs.chmodSync(`${secretDirectory}/${script}`, 0o644);
  }
  const routes = fs.readFileSync("/workspace/products/voice-agent/deploy/traefik/routes.yml", "utf8")
    .replaceAll("http://otel-lgtm:3000", "http://127.0.0.1:3000")
    .replaceAll("http://gitea:3000", "http://127.0.0.1:3001")
    .replaceAll("http://habitat:7890", "http://127.0.0.1:7890");
  fs.writeFileSync(`${secretDirectory}/traefik-routes.yml`, routes, { mode: 0o644 });
  const traefikConfig = fs.readFileSync("/workspace/products/voice-agent/deploy/traefik/traefik.yml", "utf8")
    .replace('address: "127.0.0.1:8080"', 'address: "127.0.0.1:8082"');
  fs.writeFileSync(`${secretDirectory}/traefik.yml`, traefikConfig, { mode: 0o644 });
  const randomSecret = () => randomBytes(32).toString("hex");
  const postgresPassword = ensureSecret("postgres-password", randomSecret());
  const habitatPassword = ensureSecret("habitat-database-password", postgresPassword);
  const sqlTemplate = fs.readFileSync("/workspace/.pi/postgres-full-mock-init.sql.template", "utf8");
  fs.writeFileSync(`${secretDirectory}/compose-full-mock-init.sql`,
    sqlTemplate.replaceAll("__HABITAT_PASSWORD__", habitatPassword.replaceAll("'", "''")),
    { mode: 0o644 });
  ensureSecret("database-url", `postgresql://voice_agents:${postgresPassword}@127.0.0.1:5432/voice_agents`);
  mockBrokerToken = ensureSecret("broker-token", randomSecret());
  ensureSecret("agent-gateway-token", randomSecret());
  ensureSecret("digital-twin-reader-token", randomSecret());
  ensureSecret("digital-twin-writer-token", randomSecret());
  ensureSecret("approval-secret", randomSecret());
  ensureSecret("grafana-admin-password", randomSecret());
  ensureSecret("grafana-mcp-caller-token", randomSecret());
  let brokerReady = false;
  try {
    brokerReady = (await fetch("http://127.0.0.1:9443/health", {
      signal: AbortSignal.timeout(500),
    })).ok;
  } catch { /* Start the local mock below. */ }
  if (!brokerReady) {
    const broker = spawn(process.execPath, [
      "/workspace/products/voice-agent/apps/client/tool/patrol-mock-inference-broker.mjs",
    ], { detached: true, stdio: "ignore", env: { ...process.env, PATROL_BROKER_TOKEN: mockBrokerToken } });
    broker.unref();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch("http://127.0.0.1:9443/health", { signal: AbortSignal.timeout(500) });
        if (response.ok) break;
      } catch { /* The mock is still starting. */ }
      if (attempt === 59) throw new Error("Patrol inference mock did not become ready");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}
const environment = {
  ...process.env,
  COMPOSE_FILE: `${baseComposeFile}:${devComposeFile}${fullStack ? `:${fullComposeFile}` : ""}`,
  COMPOSE_PROFILES: "",
  ORCHESTRATOR_ALLOWED_WORKSPACES: "/workspace",
  VOICE_DEFAULT_WORKSPACE: "/workspace",
  OLLAMA_MODEL: "dev-mock",
  ...(fullStack ? {
    POSTGRES_PASSWORD: fs.readFileSync(`${secretDirectory}/postgres-password`, "utf8").trim(),
    HABITAT_DB_PASSWORD: readSecret("habitat-database-password"),
    INFERENCE_BROKER_TOKEN: mockBrokerToken,
    AGENT_GATEWAY_TOKEN: fs.readFileSync(`${secretDirectory}/agent-gateway-token`, "utf8").trim(),
    DIGITAL_TWIN_READER_TOKEN: fs.readFileSync(`${secretDirectory}/digital-twin-reader-token`, "utf8").trim(),
    DIGITAL_TWIN_WRITER_TOKEN: fs.readFileSync(`${secretDirectory}/digital-twin-writer-token`, "utf8").trim(),
    GRAFANA_MCP_SERVER_TOKEN: readSecret("grafana-mcp-caller-token"),
    GRAFANA_ADMIN_PASSWORD: readSecret("grafana-admin-password"),
    ORCHESTRATOR_WORKSPACE_ROOTS: "/workspace",
  } : {}),
};
const composeFiles = ["-f", baseComposeFile, "-f", devComposeFile,
  ...(fullStack ? ["-f", fullComposeFile] : [])];
const services = execFileSync("docker", [
  "compose", ...composeFiles, "config", "--services",
], {
  encoding: "utf8",
  env: environment,
}).trim().split("\n");
for (const service of services) {
  const image = index.services?.[service];
  if (!image || !/^gondolin-cache:[a-f0-9]{24}$/.test(image.image) ||
      !/^[a-f0-9]{24}\.tar$/.test(image.archive)) {
    throw new Error(`shared image cache has no valid ${service} entry`);
  }
}

environment.COMPOSE_CACHE_SERVICES = services.join(",");
const compose = (...args) => execFileSync("dev-compose", args, {
  encoding: "utf8",
  env: environment,
  timeout: 240_000,
  stdio: ["ignore", "pipe", "pipe"],
}).trim();

const ready = async (url, headers) => {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch {
    return false;
  }
};

const waitReady = async (name, url, headers, timeoutMs = 120_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ready(url, headers)) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`${name} did not become ready at ${url} within ${timeoutMs}ms`);
};

try {
  const baseServices = [
    "postgres", "s3mock-init", "s3mock", "oxigraph-init", "oxigraph",
    "gitea", "habitat", "fluent-bit", "otel-lgtm",
  ].filter((service) => services.includes(service));
  if (fullStack) {
    compose("up", "--detach", ...baseServices);
  } else {
    compose("up", "--detach", "--wait", "--wait-timeout", "180", "--no-deps", ...services);
  }
  const checks = [
    ["Grafana", "http://127.0.0.1:3000/api/health"],
    ["Prometheus", "http://127.0.0.1:9090/-/ready"],
    ["S3Mock", "http://127.0.0.1:9092/favicon.ico"],
    ["Gitea", "http://127.0.0.1:3001/api/healthz"],
    ["Oxigraph", "http://127.0.0.1:7878/"],
  ];
  for (const [name, url] of checks) {
    if (fullStack) await waitReady(name, url);
    else if (!await ready(url)) throw new Error(`${name} did not become ready at ${url}`);
  }
  if (fullStack) {
    compose("up", "--detach", "--no-deps", "grafana-mcp-bootstrap");
    const bootstrapDeadline = Date.now() + 120_000;
    let bootstrapSucceeded = false;
    while (Date.now() < bootstrapDeadline) {
      const containerId = execFileSync("dev-compose", ["ps", "--all", "-q", "grafana-mcp-bootstrap"], {
        encoding: "utf8",
        env: environment,
      }).trim();
      if (containerId) {
        const state = execFileSync("docker", ["inspect", "--format={{.State.Status}}:{{.State.ExitCode}}", containerId], {
          encoding: "utf8",
        }).trim();
        if (state.startsWith("exited:0")) {
          bootstrapSucceeded = true;
          break;
        }
        if (state.startsWith("exited:")) throw new Error(`Grafana MCP bootstrap failed (${state})`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!bootstrapSucceeded) throw new Error("Grafana MCP bootstrap did not finish within 120000ms");

    const serviceByName = new Set(services);
    const dependencyServices = ["grafana-mcp", "agent-gateway", "trace-render-worker"]
      .filter((service) => serviceByName.has(service));
    compose("up", "--detach", "--no-deps", ...dependencyServices);
    const fullChecks = [
      ["mock inference broker", "http://127.0.0.1:9443/health"],
      ["Habitat", "http://127.0.0.1:7890/queue/_healthz"],
      ["agent gateway", "http://127.0.0.1:9444/health", { Authorization: `Bearer ${environment.AGENT_GATEWAY_TOKEN}` }],
      ["Grafana MCP", "http://127.0.0.1:8080/healthz"],
      ["trace render worker", "http://127.0.0.1:9460/health"],
      ["voice edge", "http://127.0.0.1:7860/api/features"],
      ["Traefik local ingress", "http://127.0.0.1:8081/"],
    ];
    for (const [name, url, headers] of fullChecks.slice(0, 5)) {
      await waitReady(name, url, headers);
    }
    if (serviceByName.has("voice-edge")) {
      compose("up", "--detach", "--no-deps", "voice-edge");
      await waitReady(...fullChecks[5]);
    }
    if (serviceByName.has("traefik")) {
      compose("up", "--detach", "--no-deps", "traefik");
      await waitReady(...fullChecks[6]);
    }
  }
  console.log(`dev Compose ready: ${services.join(", ")}`);
} catch (error) {
  const diagnostics = [String(error?.stack ?? error), error?.stderr && Buffer.from(error.stderr).toString("utf8")];
  try { diagnostics.push(compose("ps", "--all")); } catch (diagnosticError) {
    diagnostics.push(String(diagnosticError?.stderr ?? diagnosticError));
  }
  try { diagnostics.push(compose("logs", "--no-color", "--tail", "80")); }
  catch (diagnosticError) { diagnostics.push(String(diagnosticError?.stderr ?? diagnosticError)); }
  fs.writeFileSync("/workspace/.pi/full-compose-startup-diagnostic.log",
    diagnostics.filter(Boolean).join("\n\n").slice(-16_000));
  throw error;
}
