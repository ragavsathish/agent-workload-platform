#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const pipelineDir = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(pipelineDir, "..", "..");
const [inputArgument, outputArgument] = process.argv.slice(2);
const inputPath = inputArgument ?? path.join(pipelineDir, "examples", "composable-c4-pipeline.mmd");
const outputPath = outputArgument ?? path.join(monorepoRoot, "artifacts", "c4-excalidraw", "composable-c4-pipeline.excalidraw");
const componentDir = path.join(pipelineDir, ".wassette-components");
const layoutRepoDir = process.env.MERMAID_EXCALIDRAW_REPO
  ? path.resolve(process.env.MERMAID_EXCALIDRAW_REPO)
  : path.join(monorepoRoot, "adapters", "mermaid-to-excalidraw");
const layoutRunner = path.join(layoutRepoDir, "scripts", "render-layout-gondolin.sh");
const source = await fs.readFile(path.resolve(inputPath), "utf8");

const child = spawn("wassette", ["run", "--component-dir", componentDir, "--disable-builtin-tools"], {
  stdio: ["pipe", "pipe", "inherit"],
});
const lines = readline.createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;

lines.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const callback = pending.get(message.id);
  if (!callback) return;
  pending.delete(message.id);
  callback(message);
});

function request(method, params) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 30_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  });
}

function value(result) {
  if (result.isError) throw new Error(result.content?.[0]?.text ?? "Wassette tool failed");
  const wrapped = result.structuredContent?.result;
  if (wrapped?.err) throw new Error(`${wrapped.err.code}: ${wrapped.err.message}`);
  if (!(wrapped && "ok" in wrapped)) throw new Error(`Unexpected Wassette response: ${JSON.stringify(result)}`);
  return wrapped.ok;
}

async function call(name, args) {
  return value(await request("tools/call", { name, arguments: args }));
}

function witStyle(style) {
  return {
    fill: style?.fill ?? null,
    stroke: style?.stroke ?? null,
    "stroke-width": style?.strokeWidth ?? null,
    "stroke-dasharray": style?.strokeDasharray ?? null,
    color: style?.color ?? null,
    "font-family": style?.fontFamily ?? null,
    "font-size": style?.fontSize ?? null,
    "font-weight": style?.fontWeight ?? null,
  };
}

function toWitLayout(snapshot) {
  return {
    width: snapshot.width,
    height: snapshot.height,
    nodes: snapshot.nodes.map((node) => ({ ...node, style: witStyle(node.style) })),
    edges: snapshot.edges.map((edge) => ({
      id: edge.id,
      "source-id": edge.sourceId,
      "target-id": edge.targetId,
      points: edge.points,
      style: witStyle(edge.style),
    })),
    texts: snapshot.texts.map((entry) => ({ ...entry, style: witStyle(entry.style) })),
    renderer: snapshot.renderer,
    warnings: snapshot.warnings ?? [],
  };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { stdio: "inherit" });
    process.once("error", reject);
    process.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "c4-pipeline-"));
try {
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "composable-c4-dogfood", version: "0.1.0" },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 250));

  const prepared = await call("diagram_c4-pipeline_compiler-core_0_1_0_prepare", {
    request: {
      source,
      options: {
        direction: "automatic",
        theme: "light",
        "maximum-source-bytes": 1_048_576,
        "maximum-elements": 500,
      },
    },
  });
  const layoutPath = path.join(tempDir, "layout.json");
  const layoutInputPath = path.join(tempDir, "prepared.mmd");
  await fs.writeFile(layoutInputPath, prepared["render-request"].mermaid);
  let layoutError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await run("sh", [layoutRunner, layoutInputPath, layoutPath]);
      layoutError = undefined;
      break;
    } catch (error) {
      layoutError = error;
      if (attempt === 1) await fs.rm(layoutPath, { force: true });
    }
  }
  if (layoutError) throw layoutError;
  const layoutBytes = (await fs.stat(layoutPath)).size;
  if (layoutBytes > prepared["render-request"]["maximum-output-bytes"]) {
    throw new Error("Gondolin layout snapshot exceeded compiler limit");
  }
  const snapshot = JSON.parse(await fs.readFile(layoutPath, "utf8"));
  const compiled = await call("diagram_c4-pipeline_compiler-core_0_1_0_finish", {
    state: prepared.state,
    layout: toWitLayout(snapshot),
  });
  const approved = await call("diagram_c4-pipeline_excalidraw-policy_0_1_0_approve", {
    scene: compiled.scene,
    policy: {
      "maximum-scene-bytes": 8_388_608,
      "maximum-elements": 500,
      "allow-external-urls": false,
      "allow-embedded-files": false,
    },
  });
  const scene = {
    type: "excalidraw",
    version: 2,
    source: "pi-wassette-gondolin-c4-pipeline",
    elements: JSON.parse(approved.scene["elements-json"]),
    appState: { viewBackgroundColor: "#ffffff" },
    files: JSON.parse(approved.scene["files-json"]),
  };
  await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await fs.writeFile(path.resolve(outputPath), `${JSON.stringify(scene, null, 2)}\n`);
  let png;
  if (process.env.RENDER_PNG !== "0") {
    png = path.resolve(outputPath).replace(/\.excalidraw$/, ".png");
    await run(process.execPath, [path.join(layoutRepoDir, "scripts", "render-excalidraw.mjs"), path.resolve(outputPath), png]);
  }
  process.stdout.write(`${JSON.stringify({
    output: path.resolve(outputPath),
    png,
    renderer: snapshot.renderer,
    nodes: snapshot.nodes.length,
    edges: snapshot.edges.length,
    texts: snapshot.texts.length,
    approvedElements: scene.elements.length,
    warnings: [...compiled.warnings, ...approved.warnings],
  }, null, 2)}\n`);
} finally {
  child.kill("SIGTERM");
  await fs.rm(tempDir, { recursive: true, force: true });
}
