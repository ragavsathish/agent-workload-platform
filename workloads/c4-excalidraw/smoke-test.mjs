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

const defaultCompileOptions = {
  direction: "automatic",
  theme: "light",
  "maximum-source-bytes": 1_048_576,
  "maximum-elements": 500,
};

function compileSource(source, options = {}) {
  return request("tools/call", {
    name: "diagram_c4-pipeline_compiler_0_1_0_compile",
    arguments: { request: { source, options: { ...defaultCompileOptions, ...options } } },
  });
}

function c4ElementsCount(source, declaration) {
  return source.split(/\r?\n/u).filter((line) => line.trim().startsWith(declaration)).length;
}

function validateCompiledScene(name, compiled, expected) {
  const sceneElements = JSON.parse(compiled.scene["elements-json"]);
  if (sceneElements.length !== expected.elements) {
    throw new Error(`${name} returned ${sceneElements.length}; expected ${expected.elements}`);
  }
  if (sceneElements.filter((element) => element.type === "arrow").length !== expected.arrows) {
    throw new Error(`${name} returned an unexpected relationship count`);
  }
  const ids = new Set(sceneElements.map((element) => element.id));
  if (ids.size !== sceneElements.length) throw new Error(`${name} returned duplicate element IDs`);
  if (sceneElements.some((element) => ![element.x, element.y, element.width, element.height].every(Number.isFinite))) {
    throw new Error(`${name} returned non-finite geometry`);
  }
  const text = sceneElements.filter((element) => element.type === "text").map((element) => element.text).join("\n");
  for (const fragment of expected.text) {
    if (!text.includes(fragment)) throw new Error(`${name} omitted expected text: ${fragment}`);
  }
  for (const backgroundColor of expected.backgroundColors ?? []) {
    if (!sceneElements.some((element) => element.backgroundColor === backgroundColor)) {
      throw new Error(`${name} omitted expected background color: ${backgroundColor}`);
    }
  }
  return sceneElements;
}

async function expectCompileError(name, source, code, options = {}) {
  const result = await compileSource(source, options);
  const actual = result.structuredContent?.result?.err?.code;
  if (actual !== code) {
    throw new Error(`${name} returned ${actual ?? JSON.stringify(result)}; expected ${code}`);
  }
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
    "c2-container.mmd": 37,
    "c3-pi-extension-components.mmd": 55,
  };
  const compiledExamples = {};
  for (const example of ["c1-system-context.mmd", "c2-container.mmd", "c3-pi-extension-components.mmd"]) {
    const source = await readFile(path.join(prototypeDir, "examples", example), "utf8");
    const compile = () => compileSource(source);
    const compiled = ok(await compile());
    const repeated = ok(await compile());
    if (compiled.scene["elements-json"] !== repeated.scene["elements-json"]) {
      throw new Error(`${example} was not deterministic`);
    }
    const c4Elements = validateCompiledScene(example, compiled, {
      elements: expectedExampleElements[example],
      arrows: c4ElementsCount(source, "Rel"),
      text: [],
    });
    compiledExamples[example] = c4Elements.length;
  }

  const requestMatrix = [
    {
      name: "external system context",
      source: `C4Context
title Support Portal Context
Person_Ext(customer, "Customer", "Requests support")
System(portal, "Support Portal", "Coordinates support")
System_Ext(identity, "Identity Provider", "Authenticates customers")
Rel_R(customer, portal, "Opens ticket", "HTTPS")
Rel_R(portal, identity, "Authenticates with", "OIDC")`,
      expected: { elements: 11, arrows: 2, text: ["Support Portal Context", "Identity Provider", "OIDC"] },
    },
    {
      name: "event-driven container view",
      source: `C4Container
title Order Platform Containers
Person(buyer, "Buyer", "Places orders")
System_Boundary(platform, "Order Platform") {
  Container(api, "Order API", "TypeScript", "Accepts orders")
  ContainerDb(orders, "Order Database", "PostgreSQL", "Stores orders")
  ContainerQueue(events, "Order Events", "NATS", "Distributes order events")
}
Rel_D(buyer, api, "Places order", "HTTPS")
Rel_R(api, orders, "Writes", "SQL")
Rel_R(api, events, "Publishes OrderPlaced", "NATS")`,
      expected: { elements: 17, arrows: 3, text: ["Order Events", "Publishes OrderPlaced", "PostgreSQL"] },
    },
    {
      name: "component view with external dependency",
      source: `C4Component
title Billing API Components
Container_Boundary(billing, "Billing API") {
  Component(controller, "Invoice Controller", "HTTP adapter", "Validates requests")
  Component(service, "Invoice Service", "Domain service", "Creates invoices")
  Component(repository, "Invoice Repository", "Port", "Stores invoices")
}
System_Ext(tax, "Tax Service", "Calculates tax")
Rel_L(tax, controller, "Returns tax", "HTTPS")
Rel_R(controller, service, "Creates invoice")
Rel_R(service, repository, "Persists invoice")`,
      expected: { elements: 17, arrows: 3, text: ["Billing API Components", "Invoice Service", "Tax Service"] },
    },
    {
      name: "dynamic checkout interaction",
      source: `C4Dynamic
title Checkout Runtime
Person(shopper, "Shopper")
System(store, "Online Store")
System_Ext(payment, "Payment Provider")
Rel_D(shopper, store, "1. Starts checkout", "HTTPS")
Rel_R(store, payment, "2. Authorizes payment", "API")
Rel_U(payment, store, "3. Returns authorization", "API")`,
      expected: {
        elements: 13,
        arrows: 3,
        text: ["Checkout Runtime", "1. Starts checkout", "3. Returns authorization"],
        backgroundColors: ["#1c4f75", "#155b89", "#343a40"],
      },
      options: { theme: "dark", direction: "top-to-bottom" },
    },
    {
      name: "nested deployment view",
      source: `C4Deployment
title Production Deployment
Deployment_Node(cloud, "Cloud Region", "AWS", "Production region") {
  Deployment_Node(cluster, "Application Cluster", "Kubernetes", "Runs services") {
    Container_Instance(api, "Order API Instance", "Container", "Serves traffic")
    Container_Instance(worker, "Order Worker Instance", "Container", "Consumes events")
  }
  ContainerDb(database, "Orders", "Managed PostgreSQL", "Stores order data")
}
System_Ext(gateway, "Edge Gateway", "Routes requests")
Rel_D(gateway, api, "Routes", "HTTPS")
Rel_R(api, database, "Reads and writes", "TLS")
Rel_R(api, worker, "Dispatches work", "Queue")`,
      expected: { elements: 19, arrows: 3, text: ["Production Deployment", "Application Cluster", "Managed PostgreSQL"] },
    },
  ];
  const compiledRequests = {};
  for (const testCase of requestMatrix) {
    const first = ok(await compileSource(testCase.source, testCase.options));
    const second = ok(await compileSource(testCase.source, testCase.options));
    if (first.scene["elements-json"] !== second.scene["elements-json"]) {
      throw new Error(`${testCase.name} was not deterministic`);
    }
    compiledRequests[testCase.name] = validateCompiledScene(testCase.name, first, testCase.expected).length;
  }

  await expectCompileError("duplicate id", `C4Context\nPerson(user, "User")\nSystem(user, "Duplicate")`, "invalid-source");
  await expectCompileError("unknown relationship", `C4Context\nPerson(user, "User")\nRel(user, missing, "Calls")`, "invalid-source");
  await expectCompileError("unclosed boundary", `C4Container\nSystem_Boundary(system, "System") {\nContainer(api, "API", "HTTP", "Serves")`, "invalid-source");
  await expectCompileError("unsupported macro", `C4Context\nPerson(user, "User")\nBiRel(user, user, "Invalid")`, "unsupported-syntax");
  await expectCompileError("output limit", `C4Context\nPerson(user, "User")\nSystem(api, "API")\nRel(user, api, "Calls")`, "input-limit-exceeded", { "maximum-elements": 5 });

  process.stdout.write(`${JSON.stringify({ checkpointId: created["checkpoint-id"], elementCount: validated.length, roundTrip: "ok", c4Compiler: "composed-wasm", compiledExamples, compiledRequests, rejectedRequests: 5 }, null, 2)}\n`);
} finally {
  child.kill("SIGTERM");
}
