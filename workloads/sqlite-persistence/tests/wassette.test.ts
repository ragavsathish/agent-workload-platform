import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";

const wassette = process.env.WASSETTE_BIN ?? "wassette";
const component = resolve(import.meta.dirname, "../dist/memory-sqlite.wasm");
const componentDir = mkdtempSync(resolve(tmpdir(), "wassette-memory-sqlite-test-"));
mkdirSync(resolve(componentDir, "data"));

type Response = {
  id?: number;
  result?: { structuredContent?: { result: unknown } };
  error?: unknown;
};

class Session {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    number,
    { resolve: (response: Response) => void; reject: (error: Error) => void }
  >();
  private nextId = 1;
  private stdout = "";
  private stderr = "";

  constructor() {
    this.child = spawn(wassette, ["--component-dir", componentDir, "run"]);
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => (this.stderr += chunk));
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.stdout += chunk;
      let newline = this.stdout.indexOf("\n");
      while (newline >= 0) {
        const line = this.stdout.slice(0, newline).trim();
        this.stdout = this.stdout.slice(newline + 1);
        if (line !== "") this.receive(JSON.parse(line) as Response);
        newline = this.stdout.indexOf("\n");
      }
    });
    this.child.on("exit", () => {
      for (const request of this.pending.values()) {
        request.reject(new Error("Wassette exited unexpectedly: " + this.stderr));
      }
      this.pending.clear();
    });
  }

  private receive(response: Response): void {
    if (response.id === undefined) return;
    const request = this.pending.get(response.id);
    if (request === undefined) return;
    this.pending.delete(response.id);
    request.resolve(response);
  }

  private request(method: string, params: unknown): Promise<Response> {
    const id = this.nextId++;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}: ${this.stderr}`));
      }, 10_000);
      this.pending.set(id, {
        resolve: (response) => {
          clearTimeout(timer);
          resolveRequest(response);
        },
        reject,
      });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  async initialize(): Promise<void> {
    const response = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "memory-sqlite-test", version: "1" },
    });
    if (response.error !== undefined) throw new Error(JSON.stringify(response.error));
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    for (let attempt = 0; attempt < 40; attempt++) {
      const response = await this.request("tools/call", {
        name: `microsoft_memory-js_knowledge-graph-ops_${name}`,
        arguments: args,
      });
      if (response.error !== undefined) throw new Error(JSON.stringify(response.error));
      const result = response.result?.structuredContent?.result;
      if (result !== undefined) return result;
      const serialized = JSON.stringify(response);
      if (!serialized.includes("Component not found") && !serialized.includes("Tool not found")) {
        throw new Error("Tool returned no structured result: " + serialized);
      }
      await new Promise((done) => setTimeout(done, 50));
    }
    throw new Error("Wassette did not finish loading memory-sqlite");
  }

  async stop(): Promise<void> {
    if (this.child.exitCode !== null) return;
    const exited = new Promise<void>((done) => this.child.once("exit", () => done()));
    this.child.kill("SIGTERM");
    await exited;
  }
}

let session: Session;

beforeAll(async () => {
  execFileSync(wassette, [
    "component", "load", `file://${component}`, "--component-dir", componentDir,
  ]);
  execFileSync(wassette, [
    "permission", "grant", "storage", "memory-sqlite", "fs://data",
    "--access", "read,write", "--component-dir", componentDir,
  ]);
  session = new Session();
  await session.initialize();
  expect(await session.call("read-graph", {})).toEqual({
    ok: { entities: [], relations: [] },
  });
});

afterAll(async () => session.stop());

test("supports the Memory Server graph operations", async () => {
  expect(await session.call("create-entities", {
    entities: [
      { name: "Alice", "entity-type": "person", observations: ["Software engineer"] },
      { name: "Acme Corp", "entity-type": "company", observations: ["Builds rockets"] },
    ],
  })).toMatchObject({ ok: [{ name: "Alice" }, { name: "Acme Corp" }] });

  const relation = {
    "from-entity": "Alice",
    "to-entity": "Acme Corp",
    "relation-type": "works-for",
  };
  expect(await session.call("create-relations", { relations: [relation] }))
    .toEqual({ ok: [relation] });
  expect(await session.call("add-observations", {
    observations: [{ "entity-name": "Alice", contents: ["Writes TypeScript"] }],
  })).toEqual({
    ok: [{ "entity-name": "Alice", "added-observations": ["Writes TypeScript"] }],
  });

  expect(await session.call("search-nodes", { query: "engineer" })).toMatchObject({
    ok: {
      entities: [{ name: "Alice", observations: ["Software engineer", "Writes TypeScript"] }],
      relations: [relation],
    },
  });
  expect(await session.call("open-nodes", { names: ["Acme Corp"] })).toMatchObject({
    ok: { entities: [{ name: "Acme Corp" }], relations: [relation] },
  });
});

test("keeps the published duplicate semantics", async () => {
  expect(await session.call("create-entities", {
    entities: [{ name: "Alice", "entity-type": "person", observations: ["ignored"] }],
  })).toEqual({ ok: [] });
  expect(await session.call("add-observations", {
    observations: [{
      "entity-name": "Alice",
      contents: ["Writes TypeScript", "Maintains agent memory"],
    }],
  })).toEqual({
    ok: [{ "entity-name": "Alice", "added-observations": ["Maintains agent memory"] }],
  });
});

test("persists across a Wassette process restart", async () => {
  await session.stop();
  session = new Session();
  await session.initialize();
  expect(await session.call("read-graph", {})).toMatchObject({
    ok: {
      entities: [
        { name: "Alice", observations: expect.arrayContaining(["Maintains agent memory"]) },
        { name: "Acme Corp" },
      ],
      relations: [{ "relation-type": "works-for" }],
    },
  });
});

test("deletes observations, relations, and connected entity data", async () => {
  const relation = {
    "from-entity": "Alice",
    "to-entity": "Acme Corp",
    "relation-type": "works-for",
  };
  expect(await session.call("delete-observations", {
    deletions: [{ "entity-name": "Alice", observations: ["Software engineer"] }],
  })).toEqual({ ok: null });
  expect(await session.call("delete-relations", { relations: [relation] }))
    .toEqual({ ok: null });
  expect(await session.call("delete-entities", { "entity-names": ["Acme Corp"] }))
    .toEqual({ ok: null });
  expect(await session.call("read-graph", {})).toEqual({
    ok: {
      entities: [{
        name: "Alice",
        "entity-type": "person",
        observations: ["Writes TypeScript", "Maintains agent memory"],
      }],
      relations: [],
    },
  });
});
