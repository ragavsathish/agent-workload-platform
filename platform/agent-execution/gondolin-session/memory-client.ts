import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";

export type MemoryMcpOptions = {
  storagePath: string;
  serverPath?: string;
};

const require = createRequire(import.meta.url);

function installedServerPath(): string {
  const packagePath = require.resolve("@modelcontextprotocol/server-memory/package.json");
  return path.join(path.dirname(packagePath), "dist", "index.js");
}

export class MemoryMcp {
  private client?: Client;
  private transport?: StdioClientTransport;

  constructor(private readonly options: MemoryMcpOptions) {}

  async start(): Promise<void> {
    if (this.client) return;
    fs.mkdirSync(path.dirname(this.options.storagePath), { recursive: true });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [this.options.serverPath ?? installedServerPath()],
      env: {
        ...getDefaultEnvironment(),
        MEMORY_FILE_PATH: this.options.storagePath,
      },
      stderr: "inherit",
    });
    const client = new Client({ name: "pi-memory", version: "0.1.0" });
    this.transport = transport;
    this.client = client;
    try {
      await client.connect(transport);
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
    return this.client!.callTool({ name, arguments: args });
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.transport = undefined;
    await client?.close();
  }
}
