import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execute = promisify(execFile);

export type WassetteMemoryOptions = {
  componentPath: string;
  componentDir: string;
  wassetteCommand?: string;
};

export class WassetteMemoryMcp {
  private client?: Client;
  private transport?: StdioClientTransport;

  constructor(private readonly options: WassetteMemoryOptions) {}

  async start(): Promise<void> {
    if (this.client) return;
    if (!fs.existsSync(this.options.componentPath)) {
      throw new Error(
        `Missing SQLite memory component: ${this.options.componentPath}. Run make memory-sqlite-build.`,
      );
    }

    const command = this.options.wassetteCommand ?? "wassette";
    fs.mkdirSync(path.join(this.options.componentDir, "data"), { recursive: true });
    try {
      await execute(command, [
        "component", "unload", "memory-sqlite", "--component-dir", this.options.componentDir,
      ]);
    } catch {
      // A first run has nothing to unload.
    }
    await execute(command, [
      "component", "load", `file://${this.options.componentPath}`,
      "--component-dir", this.options.componentDir,
    ]);
    await execute(command, [
      "permission", "grant", "storage", "memory-sqlite", "fs://data",
      "--access", "read,write", "--component-dir", this.options.componentDir,
    ]);

    const transport = new StdioClientTransport({
      command,
      args: [
        "run", "--component-dir", this.options.componentDir, "--disable-builtin-tools",
      ],
      stderr: "inherit",
    });
    const client = new Client({ name: "pi-playwright-memory", version: "0.1.0" });
    this.transport = transport;
    this.client = client;
    try {
      await client.connect(transport);
      for (let attempt = 0; attempt < 40; attempt++) {
        const { tools } = await client.listTools();
        if (tools.some((tool) =>
          tool.name.startsWith("microsoft_memory-js_knowledge-graph-ops_"))) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Wassette did not finish loading memory-sqlite");
    } catch (error) {
      this.client = undefined;
      this.transport = undefined;
      await transport.close();
      throw error;
    }
  }

  async listTools() {
    await this.start();
    return this.client!.listTools();
  }

  async callTool(name: string, args: Record<string, unknown>) {
    await this.start();
    for (let attempt = 0; attempt < 40; attempt++) {
      const result = await this.client!.callTool({ name, arguments: args });
      if (!JSON.stringify(result).includes("Component not found")) return result;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Wassette registered memory-sqlite but did not make it callable");
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.transport = undefined;
    await client?.close();
  }
}
