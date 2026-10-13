import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { MemoryMcp } from "./dist/memory-client.js";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-workload-memory-"));
const storagePath = path.join(temporaryDirectory, "memory.jsonl");
const entityName = `memory-smoke-${process.pid}`;

let memory = new MemoryMcp({ storagePath });
try {
  const { tools } = await memory.listTools();
  assert.equal(tools.length, 9);
  assert(tools.some((tool) => tool.name === "create_entities"));
  assert(tools.some((tool) => tool.name === "read_graph"));

  const created = await memory.callTool("create_entities", {
    entities: [{
      name: entityName,
      entityType: "test",
      observations: ["persists across a process restart"],
    }],
  });
  assert.equal(created.isError, undefined);

  await memory.close();
  memory = new MemoryMcp({ storagePath });
  const graph = await memory.callTool("read_graph", {});
  assert.equal(graph.isError, undefined);
  assert(JSON.stringify(graph).includes(entityName));
  console.log(`Maintained memory MCP: ${tools.length} tools; persistence passed`);
} finally {
  await memory.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
