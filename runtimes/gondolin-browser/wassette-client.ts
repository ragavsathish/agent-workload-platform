import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";

const execute = promisify(execFile);

type Permission =
  | { kind: "storage"; uri: string; access: "read" | "write" | "read,write" }
  | { kind: "network"; host: string }
  | { kind: "environment-variable"; key: string };

export type WassetteComponent = {
  id: string;
  source: string;
  toolPrefix: string;
  permissions: Permission[];
};

export type WassetteOptions = {
  components: WassetteComponent[];
  componentDir: string;
  environment?: Record<string, string>;
  wassetteCommand?: string;
};

function permissionArguments(component: WassetteComponent, permission: Permission): string[] {
  if (permission.kind === "storage") {
    return [
      "permission", "grant", "storage", component.id, permission.uri,
      "--access", permission.access,
    ];
  }
  if (permission.kind === "network") {
    return ["permission", "grant", "network", component.id, permission.host];
  }
  return ["permission", "grant", "environment-variable", component.id, permission.key];
}

export class WassetteMcp {
  private client?: Client;
  private transport?: StdioClientTransport;

  constructor(private readonly options: WassetteOptions) {}

  async start(): Promise<void> {
    if (this.client) return;
    const command = this.options.wassetteCommand ?? "wassette";
    fs.mkdirSync(path.join(this.options.componentDir, "data"), { recursive: true });

    for (const component of this.options.components) {
      if (component.source.startsWith("file://")) {
        const localPath = fileURLToPath(component.source);
        if (!fs.existsSync(localPath)) {
          throw new Error(`Missing Wassette component: ${localPath}`);
        }
      }
      try {
        await execute(command, [
          "component", "unload", component.id,
          "--component-dir", this.options.componentDir,
        ]);
      } catch {
        // A first run has nothing to unload.
      }
      await execute(command, [
        "component", "load", component.source,
        "--component-dir", this.options.componentDir,
      ]);
      for (const permission of component.permissions) {
        await execute(command, [
          ...permissionArguments(component, permission),
          "--component-dir", this.options.componentDir,
        ]);
      }
    }

    const transport = new StdioClientTransport({
      command,
      args: ["run", "--component-dir", this.options.componentDir, "--disable-builtin-tools"],
      env: { ...getDefaultEnvironment(), ...this.options.environment },
      stderr: "inherit",
    });
    const client = new Client({ name: "pi-gondolin-wassette", version: "0.1.0" });
    this.transport = transport;
    this.client = client;
    try {
      await client.connect(transport);
      for (let attempt = 0; attempt < 40; attempt++) {
        const { tools } = await client.listTools();
        if (this.options.components.every((component) =>
          tools.some((tool) => tool.name.startsWith(component.toolPrefix)))) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Wassette did not register every configured component");
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
    throw new Error(`Wassette registered ${name} but did not make it callable`);
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.transport = undefined;
    await client?.close();
  }
}
