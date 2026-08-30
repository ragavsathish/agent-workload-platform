import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const prototypeDir = path.dirname(fileURLToPath(import.meta.url));
const componentDir = path.join(prototypeDir, ".wassette-components");
const child = spawn("wassette", ["run", "--component-dir", componentDir], {
  stdio: ["pipe", "pipe", "inherit"],
});
const lines = readline.createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;

lines.on("line", (line) => {
  const message = JSON.parse(line);
  const callback = pending.get(message.id);
  if (callback) {
    pending.delete(message.id);
    callback(message);
  }
});

function request(method, params) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 10_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  });
}

function ok(result) {
  const value = result.structuredContent?.result;
  if (value?.err) throw new Error(typeof value.err === "string" ? value.err : JSON.stringify(value.err));
  return value?.ok;
}

async function waitUntilReady() {
  const deadline = Date.now() + 10_000;
  await new Promise((resolve) => setTimeout(resolve, 100));
  while (true) {
    const probe = await request("tools/call", {
      name: "prototype_excalidraw-core_diagrams_read-me",
      arguments: {},
    });
    if (!probe.isError) return;
    if (Date.now() >= deadline) throw new Error(probe.content?.[0]?.text ?? "Component not ready");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

try {
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "excalidraw-wassette-smoke", version: "0.0.0" },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
  await waitUntilReady();

  const elements = [
    { type: "cameraUpdate", x: 0, y: 0, width: 800, height: 600 },
    { type: "rectangle", id: "pi", x: 60, y: 80, width: 180, height: 90, label: { text: "Pi" } },
    { type: "rectangle", id: "wasm", x: 360, y: 80, width: 220, height: 90, label: { text: "Wassette" } },
    { type: "arrow", id: "flow", x: 240, y: 125, width: 120, height: 0, points: [[0, 0], [120, 0]] },
  ];
  const created = ok(await request("tools/call", {
    name: "prototype_excalidraw-core_diagrams_create-view",
    arguments: { elements: JSON.stringify(elements), "base-elements": "" },
  }));
  if (!created?.["checkpoint-id"]) throw new Error("No checkpoint returned");

  elements[1].label.text = "Pi host";
  const validated = JSON.parse(ok(await request("tools/call", {
    name: "prototype_excalidraw-core_diagrams_save-checkpoint",
    arguments: { id: created["checkpoint-id"], elements: JSON.stringify(elements) },
  })));
  if (validated[1]?.label?.text !== "Pi host") throw new Error("Validation round trip failed");

  const expectedExampleElements = {
    "c1-system-context.mmd": 15,
    "c2-container.mmd": 55,
    "c3-pi-extension-components.mmd": 51,
  };
  const compiledExamples = {};
  for (const example of ["c1-system-context.mmd", "c2-container.mmd", "c3-pi-extension-components.mmd"]) {
    const source = await readFile(path.join(prototypeDir, "examples", example), "utf8");
    const compile = () => request("tools/call", {
      name: "diagram_c4-pipeline_compiler_0_1_0_compile",
      arguments: {
        request: {
          source,
          options: {
            direction: "automatic",
            theme: "light",
            "maximum-source-bytes": 1_048_576,
            "maximum-elements": 500,
          },
        },
      },
    });
    const compiled = ok(await compile());
    const repeated = ok(await compile());
    if (compiled.scene["elements-json"] !== repeated.scene["elements-json"]) {
      throw new Error(`${example} was not deterministic`);
    }
    const c4Elements = JSON.parse(compiled.scene["elements-json"]);
    if (c4Elements.length !== expectedExampleElements[example]) {
      throw new Error(`${example} returned ${c4Elements.length}; expected ${expectedExampleElements[example]}`);
    }
    const ids = new Set(c4Elements.map((element) => element.id));
    if (ids.size !== c4Elements.length) throw new Error(`${example} returned duplicate element IDs`);
    if (c4Elements.some((element) => ![element.x, element.y, element.width, element.height].every(Number.isFinite))) {
      throw new Error(`${example} returned non-finite geometry`);
    }
    compiledExamples[example] = c4Elements.length;
  }

  process.stdout.write(`${JSON.stringify({ checkpointId: created["checkpoint-id"], elementCount: validated.length, roundTrip: "ok", c4Compiler: "composed-wasm", compiledExamples }, null, 2)}\n`);
} finally {
  child.kill("SIGTERM");
}
