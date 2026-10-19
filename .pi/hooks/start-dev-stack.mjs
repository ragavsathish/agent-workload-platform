#!/usr/bin/env node

// Pi's session_start runs this inside the disposable development VM, after dockerd.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const cache = "/image-cache";
const baseComposeFile = "/workspace/products/voice-agent/deploy/compose.yml";
const devComposeFile = "/workspace/.pi/compose.dev.yml";

if (!fs.existsSync(`${cache}/index.json`)) {
  console.log("dev Compose skipped: shared image cache is not mounted");
  process.exit(0);
}

const index = JSON.parse(fs.readFileSync(`${cache}/index.json`, "utf8"));
const environment = {
  ...process.env,
  COMPOSE_FILE: `${baseComposeFile}:${devComposeFile}`,
  COMPOSE_PROFILES: "",
  ORCHESTRATOR_ALLOWED_WORKSPACES: "/workspace",
  VOICE_DEFAULT_WORKSPACE: "/workspace",
  OLLAMA_MODEL: "dev-mock",
};
const services = execFileSync("docker", [
  "compose", "-f", baseComposeFile, "-f", devComposeFile, "config", "--services",
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

const ready = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch {
    return false;
  }
};

try {
  compose("up", "--detach", "--wait", "--wait-timeout", "120", "--no-deps", ...services);
  const checks = [
    ["Grafana", "http://127.0.0.1:3000/api/health"],
    ["Prometheus", "http://127.0.0.1:9090/-/ready"],
    ["S3Mock", "http://127.0.0.1:9092/favicon.ico"],
    ["Gitea", "http://127.0.0.1:3001/api/healthz"],
    ["Oxigraph", "http://127.0.0.1:7878/"],
  ];
  for (const [name, url] of checks) {
    if (!await ready(url)) throw new Error(`${name} did not become ready at ${url}`);
  }
  console.log(`dev Compose ready: ${services.join(", ")}`);
} catch (error) {
  try { console.error(compose("ps", "--all")); } catch { /* Startup error is primary. */ }
  throw error;
}
