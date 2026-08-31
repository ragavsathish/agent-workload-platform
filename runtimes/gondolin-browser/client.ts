import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  createHttpHooks,
  RealFSProvider,
  VM,
  type ExecProcess,
} from "@earendil-works/gondolin";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";

const MCP_COMMAND = [
  "/usr/local/bin/node",
  "/app/cli.js",
  "--headless",
  "--browser",
  "chromium",
  "--no-sandbox",
  "--isolated",
  "--ignore-https-errors",
  "--image-responses",
  "allow",
  "--output-dir",
  "/output",
  "--output-max-size",
  "10485760",
] as const;

export type GuestSidecar = {
  command: string[];
  readyText: string;
  timeoutMs?: number;
};

export type GondolinBrowserOptions = {
  imagePath: string;
  mounts?: Record<string, string>;
  allowedHosts?: string[];
  sidecars?: GuestSidecar[];
  sessionLabel?: string;
};

class GondolinStdioTransport implements Transport {
  private readonly readBuffer = new ReadBuffer({ maxBufferSize: 16 * 1024 * 1024 });
  private process?: ExecProcess;
  private closing = false;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T) => void;

  constructor(
    private readonly vm: VM,
    private readonly command: readonly string[],
  ) {}

  async start(): Promise<void> {
    if (this.process) throw new Error("Playwright MCP transport is already started");
    const child = this.vm.exec([...this.command], {
      stdin: true,
      stdout: "pipe",
      stderr: "pipe",
    });
    this.process = child;
    child.stdout?.on("data", (chunk: Buffer) => {
      try {
        this.readBuffer.append(chunk);
        while (true) {
          const message = this.readBuffer.readMessage();
          if (!message) break;
          this.onmessage?.(message);
        }
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[playwright-mcp-vm] ${chunk.toString("utf8")}`);
    });
    void child.result.then((result) => {
      this.process = undefined;
      if (!this.closing && result.exitCode !== 0) {
        this.onerror?.(new Error(`Playwright MCP exited with code ${result.exitCode}: ${result.stderr}`));
      }
      this.onclose?.();
    }).catch((error: unknown) => {
      this.process = undefined;
      this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      this.onclose?.();
    });
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (!this.process) throw new Error("Playwright MCP transport is not connected");
    this.process.write(serializeMessage(message));
  }

  async close(): Promise<void> {
    if (!this.process) return;
    this.closing = true;
    const child = this.process;
    child.end();
    await Promise.race([
      child.result.then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
    this.process = undefined;
    this.readBuffer.clear();
  }
}

async function waitForSidecar(guestProcess: ExecProcess, sidecar: GuestSidecar): Promise<void> {
  const timeoutMs = sidecar.timeoutMs ?? 15_000;
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Guest sidecar did not report ${JSON.stringify(sidecar.readyText)} within ${timeoutMs}ms`));
    }, timeoutMs);
    const complete = () => {
      clearTimeout(timeout);
      resolve();
    };
    guestProcess.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.includes(sidecar.readyText)) complete();
    });
    guestProcess.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[gondolin-browser-sidecar] ${chunk.toString("utf8")}`);
    });
    void guestProcess.result.then((result) => {
      if (!output.includes(sidecar.readyText)) {
        clearTimeout(timeout);
        reject(new Error(`Guest sidecar exited with code ${result.exitCode}: ${result.stderr}`));
      }
    });
  });
}

export class GondolinPlaywrightMcp {
  private vm?: VM;
  private transport?: GondolinStdioTransport;
  private client?: Client;
  private sidecarProcesses: ExecProcess[] = [];
  private readonly outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "gondolin-browser-output-"));

  constructor(private readonly options: GondolinBrowserOptions) {}

  async start(): Promise<void> {
    if (this.client) return;
    if (!fs.existsSync(this.options.imagePath)) {
      throw new Error(`Missing Gondolin browser assets: ${this.options.imagePath}`);
    }
    const { httpHooks, env } = createHttpHooks({ allowedHosts: this.options.allowedHosts });
    const mounts = Object.fromEntries(
      Object.entries({ "/output": this.outputDirectory, ...this.options.mounts })
        .map(([guestPath, hostPath]) => [guestPath, new RealFSProvider(hostPath)]),
    );
    const vm = await VM.create({
      sandbox: { imagePath: this.options.imagePath },
      httpHooks,
      env,
      vfs: { mounts },
      memory: "2G",
      cpus: 2,
      sessionLabel: this.options.sessionLabel ?? "pi-playwright-mcp",
    });
    this.vm = vm;
    try {
      for (const sidecar of this.options.sidecars ?? []) {
        const process = vm.exec(sidecar.command, { stdin: true, stdout: "pipe", stderr: "pipe" });
        this.sidecarProcesses.push(process);
        await waitForSidecar(process, sidecar);
      }
      const transport = new GondolinStdioTransport(vm, MCP_COMMAND);
      const client = new Client({ name: "pi-gondolin-playwright", version: "0.1.0" });
      this.transport = transport;
      this.client = client;
      await client.connect(transport);
    } catch (error) {
      await this.close();
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
    const vm = this.vm;
    this.client = undefined;
    this.transport = undefined;
    this.vm = undefined;
    try {
      await client?.close();
    } finally {
      const sidecars = this.sidecarProcesses.splice(0);
      for (const sidecar of sidecars) sidecar.end();
      await Promise.all(sidecars.map((sidecar) => Promise.race([
        sidecar.result.then(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ])));
      try {
        await vm?.close();
      } finally {
        fs.rmSync(this.outputDirectory, { recursive: true, force: true });
      }
    }
  }
}
