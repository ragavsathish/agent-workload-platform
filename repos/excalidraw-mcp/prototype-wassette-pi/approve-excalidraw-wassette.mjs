import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error("usage: node approve-excalidraw-wassette.mjs INPUT.excalidraw OUTPUT.excalidraw");
  process.exit(2);
}

const prototypeDir = path.dirname(fileURLToPath(import.meta.url));
const componentDir = path.join(prototypeDir, ".wassette-components");
const scene = JSON.parse(await fs.readFile(path.resolve(inputPath), "utf8"));
if (!Array.isArray(scene.elements)) throw new Error("Expected an Excalidraw scene with an elements array");

const child = spawn(
  "wassette",
  ["run", "--component-dir", componentDir, "--disable-builtin-tools"],
  { stdio: ["pipe", "pipe", "inherit"] },
);
const lines = readline.createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;

lines.on("line", (line) => {
  const message = JSON.parse(line);
  const callback = pending.get(message.id);
  if (!callback) return;
  pending.delete(message.id);
  callback(message);
});

function request(method, params) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 15_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  });
}

function componentValue(result) {
  const value = result.structuredContent?.result;
  if (value?.err) throw new Error(value.err);
  if (!(value && "ok" in value)) throw new Error(`Unexpected Wassette response: ${JSON.stringify(result)}`);
  return value.ok;
}

async function waitUntilReady() {
  const deadline = Date.now() + 15_000;
  await new Promise((resolve) => setTimeout(resolve, 100));
  while (true) {
    const probe = await request("tools/call", {
      name: "prototype_excalidraw-core_diagrams_read-me",
      arguments: {},
    });
    if (!probe.isError) return;
    if (Date.now() >= deadline) throw new Error(probe.content?.[0]?.text ?? "Wassette component not ready");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

try {
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "excalidraw-policy-dogfood", version: "0.0.0" },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
  await waitUntilReady();

  const result = await request("tools/call", {
    name: "prototype_excalidraw-core_diagrams_create-view",
    arguments: {
      elements: JSON.stringify(scene.elements),
      "base-elements": "",
    },
  });
  if (result.isError) throw new Error(result.content?.[0]?.text ?? "Wassette approval failed");
  const approved = componentValue(result);
  const elements = JSON.parse(approved.elements);
  await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await fs.writeFile(
    path.resolve(outputPath),
    `${JSON.stringify({ ...scene, elements }, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify({ checkpointId: approved["checkpoint-id"], elementCount: elements.length, warning: approved.warning }, null, 2)}\n`);
} finally {
  child.kill("SIGTERM");
}
