/** PROTOTYPE: Pi tool -> Wassette component -> cloned Excalidraw MCP App. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const pipelineDir = path.dirname(fileURLToPath(import.meta.url));
const componentDir = path.join(pipelineDir, ".wassette-components");
const gondolinArch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : undefined;
const gondolinAssets = path.resolve(
  process.env.C4_GONDOLIN_ASSETS ?? path.join(pipelineDir, "..", "..", "artifacts", "c4-gondolin", gondolinArch ?? "unsupported"),
);
const hostHtml = path.join(pipelineDir, "dist", "host.html");
const appHtml = path.join(pipelineDir, "dist", "mcp-app.html");
const CREATE_VIEW = "prototype_excalidraw-core_diagrams_create-view";
const SAVE_CHECKPOINT = "prototype_excalidraw-core_diagrams_save-checkpoint";
const READ_ME = "prototype_excalidraw-core_diagrams_read-me";
const C4_COMPILE = "diagram_c4-pipeline_compiler_0_1_0_compile";
const C4_PREPARE = "diagram_c4-pipeline_compiler-core_0_1_0_prepare";
const C4_FINISH = "diagram_c4-pipeline_compiler-core_0_1_0_finish";
const EXCALIDRAW_APPROVE = "diagram_c4-pipeline_excalidraw-policy_0_1_0_approve";
const c4LayoutBackend = process.env.C4_LAYOUT_BACKEND === "gondolin" ? "gondolin" : "wasm";

type JsonRpcResult = { content?: Array<{ type: string; text?: string }>; structuredContent?: any; isError?: boolean };
type ViewState = { checkpointId: string; elements: unknown[]; warning: string };

class WassetteClient {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();

  async start() {
    if (this.child) return;
    this.child = spawn("wassette", ["run", "--component-dir", componentDir, "--disable-builtin-tools"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr.on("data", (chunk) => process.stderr.write(`[wassette] ${chunk}`));
    this.child.once("exit", (code) => {
      const error = new Error(`Wassette exited with code ${code}`);
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
      this.child = undefined;
    });
    readline.createInterface({ input: this.child.stdout }).on("line", (line) => {
      let message: any;
      try { message = JSON.parse(line); } catch { return; }
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      else request.resolve(message.result);
    });
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "pi-excalidraw-wassette-prototype", version: "0.0.0" },
    });
    this.notify("notifications/initialized", {});
    const deadline = Date.now() + 10_000;
    await new Promise((resolve) => setTimeout(resolve, 100));
    while (true) {
      const probe = await this.request("tools/call", { name: READ_ME, arguments: {} });
      if (!probe.isError) break;
      if (Date.now() >= deadline) {
        throw new Error(probe.content?.[0]?.text ?? "Wassette component did not become ready");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child!.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  private notify(method: string, params: unknown) {
    this.child!.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<JsonRpcResult> {
    await this.start();
    const result = await this.request("tools/call", { name, arguments: args });
    if (result.isError) throw new Error(result.content?.[0]?.text ?? `${name} failed`);
    return result;
  }

  stop() {
    this.child?.kill("SIGTERM");
    this.child = undefined;
  }
}

function componentValue(result: JsonRpcResult): any {
  const value = result.structuredContent?.result;
  if (value?.err) {
    const details = value.err.details ? ` (${value.err.details})` : "";
    throw new Error(`${value.err.code ?? "component-error"}: ${value.err.message ?? JSON.stringify(value.err)}${details}`);
  }
  if (!("ok" in (value ?? {}))) throw new Error(`Unexpected Wassette response: ${JSON.stringify(result)}`);
  return value.ok;
}


function witStyle(style: any) {
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

function toWitLayout(snapshot: any) {
  return {
    width: snapshot.width,
    height: snapshot.height,
    nodes: snapshot.nodes.map((node: any) => ({
      id: node.id,
      shape: node.shape,
      bounds: node.bounds,
      style: witStyle(node.style),
    })),
    edges: snapshot.edges.map((edge: any) => ({
      id: edge.id,
      "source-id": edge.sourceId,
      "target-id": edge.targetId,
      points: edge.points,
      style: witStyle(edge.style),
    })),
    texts: snapshot.texts.map((entry: any) => ({
      id: entry.id,
      text: entry.text,
      bounds: entry.bounds,
      style: witStyle(entry.style),
    })),
    renderer: snapshot.renderer,
    warnings: snapshot.warnings ?? [],
  };
}

function openBrowser(url: string) {
  const [command, args] = process.platform === "darwin"
    ? ["open", [url]]
    : process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

export default function (pi: ExtensionAPI) {
  const wassette = new WassetteClient();
  let server: Server | undefined;
  let port = 0;
  let token = "";
  let state: ViewState | undefined;
  const checkpoints = new Map<string, unknown[]>();

  function requireArtifacts() {
    for (const required of [hostHtml, appHtml, path.join(componentDir, "excalidraw-core.wasm")]) {
      if (!fs.existsSync(required)) throw new Error(`Missing ${required}. Follow the install and build commands in workloads/c4-excalidraw/README.md.`);
    }
  }

  function requireC4Artifacts() {
    requireArtifacts();
    for (const required of [
      path.join(componentDir, "c4-pipeline.wasm"),
      path.join(componentDir, "excalidraw-policy.wasm"),
    ]) {
      if (!fs.existsSync(required)) throw new Error(`Missing ${required}. Follow the install and build commands in workloads/c4-excalidraw/README.md.`);
    }
    if (c4LayoutBackend === "gondolin" && !fs.existsSync(gondolinAssets)) {
      throw new Error(`Missing ${gondolinAssets}. Run make c4-gondolin-build before selecting the Gondolin fallback.`);
    }
    if (c4LayoutBackend === "gondolin" && !fs.existsSync(path.join(componentDir, "c4-compiler.wasm"))) {
      throw new Error(`Missing ${path.join(componentDir, "c4-compiler.wasm")}. Rebuild and load the C4 components.`);
    }
  }

  async function renderLayoutInGondolin(mermaid: string, maximumOutputBytes: number) {
    const { RealFSProvider, VM } = await import("@earendil-works/gondolin");
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-c4-layout-"));
    const inputPath = path.join(tempDir, "diagram.mmd");
    const outputPath = path.join(tempDir, "layout.json");
    try {
      fs.writeFileSync(inputPath, mermaid);
      let lastError: unknown;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          if (!gondolinArch) throw new Error(`Unsupported host architecture: ${process.arch}`);
          const vm = await VM.create({
            sandbox: { imagePath: gondolinAssets },
            vfs: { mounts: { "/work": new RealFSProvider(tempDir) } },
          });
          try {
            const result = await vm.exec([
              "/usr/bin/node",
              "/app/adapters/c4-gondolin/scripts/render-layout-snapshot.mjs",
              "/work/diagram.mmd",
              "/work/layout.json",
            ]);
            if (!result.ok) throw new Error(`Gondolin layout failed (${result.exitCode}): ${result.stderr}`);
          } finally {
            await vm.close();
          }
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          if (attempt === 1) fs.rmSync(outputPath, { force: true });
        }
      }
      if (lastError) throw lastError;
      const size = fs.statSync(outputPath).size;
      if (size > maximumOutputBytes) throw new Error(`Browser layout output exceeds ${maximumOutputBytes} bytes`);
      return JSON.parse(fs.readFileSync(outputPath, "utf8"));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  async function ensureServer() {
    if (server) return;
    token = randomBytes(24).toString("hex");
    server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const authorized = request.headers.cookie?.split(/;\s*/).includes(`excalidraw_token=${token}`);

      if (url.pathname === `/view/${token}`) {
        response.setHeader("set-cookie", `excalidraw_token=${token}; HttpOnly; SameSite=Strict; Path=/`);
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(fs.readFileSync(hostHtml));
        return;
      }
      if (url.pathname === "/mcp-app.html") {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(fs.readFileSync(appHtml));
        return;
      }
      if (!authorized) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      if (url.pathname === "/api/state" && request.method === "GET") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(state));
        return;
      }
      if (url.pathname === "/api/tool" && request.method === "POST") {
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const call = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          let result: JsonRpcResult;
          if (call.name === "save_checkpoint") {
            const parsed = JSON.parse(call.arguments.data);
            result = await wassette.callTool(SAVE_CHECKPOINT, {
              id: call.arguments.id,
              elements: JSON.stringify(parsed.elements ?? []),
            });
            const elements = JSON.parse(componentValue(result));
            checkpoints.set(call.arguments.id, elements);
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ content: [{ type: "text", text: "ok" }] }));
            return;
          }
          if (call.name === "read_checkpoint") {
            const elements = checkpoints.get(call.arguments.id);
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ content: [{ type: "text", text: elements ? JSON.stringify({ elements }) : "" }] }));
            return;
          }
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({
            isError: true,
            content: [{ type: "text", text: `Prototype host does not expose ${call.name}` }],
          }));
        } catch (error) {
          response.writeHead(500, { "content-type": "text/plain" });
          response.end(error instanceof Error ? error.message : String(error));
        }
        return;
      }
      response.writeHead(404).end("Not found");
    });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", () => {
        const address = server!.address();
        if (!address || typeof address === "string") return reject(new Error("No loopback port"));
        port = address.port;
        resolve();
      });
    });
  }

  async function openElementView(elements: string) {
    requireArtifacts();
    const parsedInput = JSON.parse(elements);
    const restore = Array.isArray(parsedInput)
      ? parsedInput.find((element: any) => element?.type === "restoreCheckpoint")
      : undefined;
    const baseElements = restore?.id ? checkpoints.get(restore.id) : undefined;
    if (restore?.id && !baseElements) throw new Error(`Checkpoint ${restore.id} not found`);
    const result = await wassette.callTool(CREATE_VIEW, {
      elements,
      "base-elements": baseElements ? JSON.stringify(baseElements) : "",
    });
    const view = componentValue(result);
    state = {
      checkpointId: view["checkpoint-id"],
      elements: JSON.parse(view.elements),
      warning: view.warning,
    };
    checkpoints.set(state.checkpointId, state.elements);
    await ensureServer();
    const url = `http://127.0.0.1:${port}/view/${token}`;
    if (process.env.EXCALIDRAW_STATE_OUT) {
      fs.writeFileSync(
        path.resolve(process.env.EXCALIDRAW_STATE_OUT),
        `${JSON.stringify({ ...state, url }, null, 2)}\n`,
      );
    }
    if (process.env.EXCALIDRAW_NO_OPEN !== "1") openBrowser(url);
    return { url, checkpointId: state.checkpointId, warning: state.warning, elementCount: state.elements.length };
  }

  pi.registerTool({
    name: "excalidraw_wassette_open",
    label: "Open Excalidraw via Wassette",
    description: "Validate and checkpoint Excalidraw element JSON in Wassette, then open the cloned Excalidraw MCP App.",
    parameters: Type.Object({
      elements: Type.String({ description: "A JSON array of standard Excalidraw elements" }),
    }),
    async execute(_id, params) {
      const opened = await openElementView(params.elements);
      return {
        content: [{ type: "text", text: `Opened Excalidraw at ${opened.url}\nCheckpoint: ${opened.checkpointId}${opened.warning ? `\nWarning: ${opened.warning}` : ""}` }],
        details: opened,
      };
    },
  });

  pi.registerTool({
    name: "excalidraw_c4_render",
    label: "Render C4 Mermaid in Excalidraw",
    description: "Compile and lay out native Mermaid C4 inside Wassette, then render it with the cloned Excalidraw MCP App.",
    promptSnippet: "Render a C4 Mermaid architecture diagram as an editable Excalidraw scene",
    promptGuidelines: [
      "For excalidraw_c4_render, first apply the C4 diagram skill to choose one coherent static level and generate native Mermaid C4Context, C4Container, or C4Component syntax.",
      "Pass the complete Mermaid source to excalidraw_c4_render; do not translate it to Excalidraw JSON yourself.",
    ],
    parameters: Type.Object({
      mermaid: Type.String({ description: "Native Mermaid C4Context, C4Container, or C4Component source" }),
    }),
    async execute(_id, params) {
      requireC4Artifacts();
      const request = {
        source: params.mermaid,
        options: {
          direction: "automatic",
          theme: "light",
          "maximum-source-bytes": 1_048_576,
          "maximum-elements": 500,
        },
      };
      let compiledResult: JsonRpcResult;
      let renderer = "c4-layout-wasm/dagre";
      if (c4LayoutBackend === "gondolin") {
        const preparedResult = await wassette.callTool(C4_PREPARE, {
          request,
        });
        const prepared = componentValue(preparedResult);
        const renderRequest = prepared["render-request"];
        const snapshot = toWitLayout(await renderLayoutInGondolin(renderRequest.mermaid, renderRequest["maximum-output-bytes"]));
        renderer = snapshot.renderer;
        compiledResult = await wassette.callTool(C4_FINISH, {
          state: prepared.state,
          layout: snapshot,
        });
      } else {
        compiledResult = await wassette.callTool(C4_COMPILE, {
          request,
        });
      }
      const compiled = componentValue(compiledResult);
      const approvedResult = await wassette.callTool(EXCALIDRAW_APPROVE, {
        scene: compiled.scene,
        policy: {
          "maximum-scene-bytes": 8_388_608,
          "maximum-elements": 500,
          "allow-external-urls": false,
          "allow-embedded-files": false,
        },
      });
      const approved = componentValue(approvedResult);
      const elements = approved.scene["elements-json"];
      if (process.env.EXCALIDRAW_PIPELINE_OUT) {
        fs.writeFileSync(path.resolve(process.env.EXCALIDRAW_PIPELINE_OUT), `${JSON.stringify({
          type: "excalidraw",
          version: 2,
          source: c4LayoutBackend === "gondolin"
            ? "pi-wassette-gondolin-c4-pipeline"
            : "pi-wassette-c4-pipeline",
          elements: JSON.parse(elements),
          appState: { viewBackgroundColor: "#ffffff" },
          files: JSON.parse(approved.scene["files-json"]),
        }, null, 2)}\n`);
      }
      const opened = await openElementView(elements);
      const warnings = [...(compiled.warnings ?? []), ...(approved.warnings ?? [])];
      return {
        content: [{
          type: "text",
          text: `Rendered C4 Mermaid through ${renderer}, Wassette compilation and policy in Excalidraw at ${opened.url}\nCheckpoint: ${opened.checkpointId}\nElements: ${opened.elementCount}${warnings.length ? `\nWarnings: ${warnings.join("; ")}` : ""}`,
        }],
        details: { ...opened, renderer, warnings },
      };
    },
  });

  pi.on("session_shutdown", async () => {
    wassette.stop();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });
}
