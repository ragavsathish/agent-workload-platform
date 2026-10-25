import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";

import {
  createHttpHooks,
  ReadonlyProvider,
  RealFSProvider,
  VM,
  VmCheckpoint,
  type CreateHttpHooksOptions,
  type ExecOptions,
  type ExecProcess,
  type ExecResult,
  type VMOptions,
} from "@earendil-works/gondolin";
import {
  parseJsonRpcMessage,
  type JsonRpcMessage,
  type McpTransport,
  type McpTransportSendOptions,
} from "@earendil-works/pi-mcp";
import type { BashOperations } from "@earendil-works/pi-coding-agent";

import { createGondolinBashOperations, createGondolinCodingTools } from "./gondolin-operations.js";

const PLAYWRIGHT_MCP_COMMAND = [
  "/usr/local/bin/node", "/app/cli.js", "--headless", "--browser", "chromium",
  "--no-sandbox", "--isolated", "--ignore-https-errors", "--image-responses", "allow",
  "--output-dir", "/output", "--output-max-size", "10485760",
] as const;
const MAX_MCP_MESSAGE_BYTES = 16 * 1024 * 1024;

function memoryBytes(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([kmgt])?b?$/i);
  if (!match) throw new Error(`Invalid Gondolin memory size: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  const multiplier = unit === "t" ? 1024 ** 4
    : unit === "g" ? 1024 ** 3
      : unit === "m" ? 1024 ** 2
        : unit === "k" ? 1024
          : 1;
  return Math.round(amount * multiplier);
}

/** Resolve a repository hook to its guest mount without following a symlink out. */
export function resolveGuestHook(workspace: string, hookPath: string): string {
  const root = fs.realpathSync(workspace);
  const hook = fs.realpathSync(path.resolve(root, hookPath));
  const inside = path.relative(root, hook);
  if (!inside || inside === ".." || inside.startsWith(`..${path.sep}`)
    || path.isAbsolute(inside) || !fs.statSync(hook).isFile()) {
    throw new Error("Gondolin hook must be a file inside the task workspace");
  }
  return `/workspace/${inside.split(path.sep).join("/")}`;
}

export function resolveGuestHooks(workspace: string, value: unknown): string[] {
  if (value === undefined) return [];
  const paths = Array.isArray(value) ? value : [value];
  if (paths.length > 8 || paths.some((entry) => typeof entry !== "string" || !entry)) {
    throw new Error("Gondolin session start hooks must be at most eight non-empty paths");
  }
  return paths.map((entry: string) => resolveGuestHook(workspace, entry));
}

export function guestHookCommand(guestPath: string, args: readonly string[] = []): string[] {
  if (!guestPath.startsWith("/workspace/")) throw new Error("Gondolin hook must be inside /workspace");
  const interpreter = guestPath.endsWith(".clj") ? "/usr/local/bin/bb"
    : guestPath.endsWith(".js") ? "/usr/local/bin/node"
      : guestPath.endsWith(".sh") ? "/bin/sh" : undefined;
  if (!interpreter) throw new Error("Gondolin hook must be .clj, .js, or .sh");
  return [interpreter, guestPath, ...args];
}

export type GondolinSessionOptions = {
  imagePath: string;
  mounts?: Record<string, string | { hostPath: string; readonly?: boolean }>;
  mountOutput?: boolean;
  network: false | CreateHttpHooksOptions;
  environment?: Record<string, string>;
  dns?: VMOptions["dns"];
  sandbox?: Omit<NonNullable<VMOptions["sandbox"]>, "imagePath" | "netEnabled">;
  rootfs?: VMOptions["rootfs"];
  maxHttpResponseBodyBytes?: number;
  startupCommands?: readonly (readonly string[])[];
  memory?: string;
  cpus?: number;
  sessionLabel?: string;
  resumeCheckpointPath?: string;
};

class GondolinMcpTransport implements McpTransport {
  private process?: ExecProcess;
  private abort?: AbortController;
  private buffer = Buffer.alloc(0);
  private closing = false;
  private closed = false;
  private readonly messageListeners = new Set<(message: JsonRpcMessage) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly closeListeners = new Set<() => void>();

  constructor(
    private readonly resolveVm: () => Promise<VM>,
    private readonly command: readonly string[],
  ) {}

  onMessage(listener: (message: JsonRpcMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.process) throw new Error("Gondolin MCP transport is already started");
    const vm = await this.resolveVm();
    const abort = new AbortController();
    const child = vm.exec([...this.command], {
      stdin: true,
      stdout: "pipe",
      stderr: "pipe",
      signal: abort.signal,
    });
    this.abort = abort;
    this.process = child;
    child.stdout?.on("data", (chunk: Buffer) => this.read(chunk));
    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[gondolin-mcp] ${chunk.toString("utf8")}`);
    });
    void child.result.then((result) => {
      this.process = undefined;
      if (!this.closing && result.exitCode !== 0) {
        this.emitError(new Error(`Guest MCP exited with code ${result.exitCode}: ${result.stderr}`));
      }
      this.emitClose();
    }).catch((error: unknown) => {
      this.process = undefined;
      if (!this.closing) this.emitError(error);
      this.emitClose();
    });
  }

  async send(message: JsonRpcMessage, options?: McpTransportSendOptions): Promise<void> {
    if (options?.signal?.aborted) return;
    if (!this.process) throw new Error("Gondolin MCP transport is not connected");
    this.process.write(`${JSON.stringify(message)}\n`);
  }

  async close(): Promise<void> {
    if (!this.process) return;
    this.closing = true;
    const child = this.process;
    child.end();
    const completed = await Promise.race([
      child.result.then(() => true, () => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ]);
    if (!completed) this.abort?.abort();
    this.process = undefined;
    this.abort = undefined;
    this.buffer = Buffer.alloc(0);
    this.emitClose();
  }

  private read(chunk: Buffer): void {
    try {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (let newline = this.buffer.indexOf(0x0a); newline >= 0; newline = this.buffer.indexOf(0x0a)) {
        if (newline > MAX_MCP_MESSAGE_BYTES) {
          throw new Error(`Guest MCP message exceeds ${MAX_MCP_MESSAGE_BYTES} bytes`);
        }
        const line = this.buffer.subarray(0, newline).toString("utf8").trim();
        this.buffer = this.buffer.subarray(newline + 1);
        if (line) this.emitMessage(parseJsonRpcMessage(JSON.parse(line)));
      }
      if (this.buffer.length > MAX_MCP_MESSAGE_BYTES) {
        throw new Error(`Guest MCP message exceeds ${MAX_MCP_MESSAGE_BYTES} bytes`);
      }
    } catch (error) {
      this.emitError(error);
    }
  }

  private emitMessage(message: JsonRpcMessage): void {
    for (const listener of this.messageListeners) listener(message);
  }

  private emitError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    for (const listener of this.errorListeners) listener(normalized);
  }

  private emitClose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.closeListeners) listener();
  }
}

export class GondolinSession {
  private vm?: VM;
  private vmPromise?: Promise<VM>;
  private metricsRegistration?: string;
  private readonly outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "gondolin-browser-output-"));

  constructor(private readonly options: GondolinSessionOptions) {}

  async start(): Promise<void> {
    await this.ensureVm();
  }

  playwrightTransport(): McpTransport {
    return new GondolinMcpTransport(() => this.ensureVm(), PLAYWRIGHT_MCP_COMMAND);
  }

  async codingTools(localCwd?: string): Promise<ReturnType<typeof createGondolinCodingTools>> {
    const workspace = this.options.mounts?.["/workspace"];
    const hostWorkspace = typeof workspace === "string" ? workspace : workspace?.hostPath;
    return createGondolinCodingTools(await this.ensureVm(), hostWorkspace, localCwd);
  }

  async bashOperations(localCwd: string): Promise<BashOperations> {
    return createGondolinBashOperations(await this.ensureVm(), localCwd);
  }

  /** Run one bounded workload command without exposing the underlying VM. */
  async run(
    command: readonly string[],
    options: Omit<ExecOptions, "stdin"> & { input?: string | Buffer } = {},
  ): Promise<ExecResult> {
    if (command.length === 0) throw new Error("Gondolin command must not be empty");
    const { input, ...execOptions } = options;
    return await (await this.ensureVm()).exec([...command], {
      ...execOptions,
      stdin: input,
    });
  }

  /** Guest filesystem capability for a Pi Durable ExecutionEnv adapter. */
  async filesystem(): Promise<VM["fs"]> {
    return (await this.ensureVm()).fs;
  }

  async close(): Promise<void> {
    const vm = this.vm ?? await this.vmPromise?.catch(() => undefined);
    this.vm = undefined;
    this.vmPromise = undefined;
    try {
      await vm?.close();
    } finally {
      this.cleanupHostResources();
    }
  }

  /** Stop the VM and atomically replace its disk-only checkpoint. */
  async checkpoint(checkpointPath: string): Promise<void> {
    const vm = this.vm ?? await this.vmPromise?.catch(() => undefined);
    this.vm = undefined;
    this.vmPromise = undefined;
    if (!vm) {
      this.cleanupHostResources();
      return;
    }
    const staged = `${checkpointPath}.${randomUUID()}.tmp.qcow2`;
    try {
      fs.mkdirSync(path.dirname(checkpointPath), { recursive: true, mode: 0o700 });
      await vm.checkpoint(staged);
      fs.chmodSync(staged, 0o600);
      fs.renameSync(staged, checkpointPath);
    } finally {
      try {
        await vm.close();
      } finally {
        fs.rmSync(staged, { force: true });
        this.cleanupHostResources();
      }
    }
  }

  private cleanupHostResources(): void {
    if (this.metricsRegistration) {
      fs.rmSync(this.metricsRegistration, { force: true });
      this.metricsRegistration = undefined;
    }
    fs.rmSync(this.outputDirectory, { recursive: true, force: true });
  }

  private async ensureVm(): Promise<VM> {
    if (this.vm) return this.vm;
    if (this.vmPromise) return this.vmPromise;
    const creation = this.createVm();
    this.vmPromise = creation;
    try {
      return await creation;
    } finally {
      if (this.vmPromise === creation) this.vmPromise = undefined;
    }
  }

  private async createVm(): Promise<VM> {
    const networkEnabled = this.options.network !== false;
    const network = this.options.network === false
      ? undefined
      : createHttpHooks(this.options.network);
    const mounts = Object.fromEntries(
      Object.entries({ ...(this.options.mountOutput === false ? {} : { "/output": this.outputDirectory }), ...this.options.mounts })
        .map(([guestPath, mount]) => {
          const spec: { hostPath: string; readonly?: boolean } =
            typeof mount === "string" ? { hostPath: mount } : mount;
          const provider = new RealFSProvider(spec.hostPath);
          return [guestPath, spec.readonly ? new ReadonlyProvider(provider) : provider];
        }),
    );
    const configuredMemory = this.options.memory ?? "2G";
    const configuredCpus = this.options.cpus ?? 2;
    const vmOptions: VMOptions = {
      sandbox: {
        ...this.options.sandbox,
        imagePath: this.options.imagePath,
        netEnabled: networkEnabled,
      },
      httpHooks: network?.httpHooks,
      env: { ...this.options.environment, ...network?.env },
      dns: this.options.dns,
      vfs: { mounts },
      rootfs: this.options.rootfs,
      maxHttpResponseBodyBytes: this.options.maxHttpResponseBodyBytes,
      memory: configuredMemory,
      cpus: configuredCpus,
      sessionLabel: this.options.sessionLabel ?? "pi-playwright-mcp",
    };
    const checkpointPath = this.options.resumeCheckpointPath;
    const vm = checkpointPath && fs.existsSync(checkpointPath)
      ? await VmCheckpoint.load(checkpointPath).resume<VM>(vmOptions)
      : await VM.create(vmOptions);
    await vm.start();
    try {
      for (const command of this.options.startupCommands ?? []) {
        if (command.length === 0) throw new Error("Gondolin startup command must not be empty");
        const result = await vm.exec([...command]);
        if (!result.ok) {
          const output = [result.stderr.trim(), result.stdout.trim()]
            .filter(Boolean)
            .join("\n")
            .slice(-4_000);
          throw new Error(
            `Gondolin startup command ${command[0]} exited with code ${result.exitCode}`
            + (output ? `:\n${output}` : ""),
          );
        }
      }
      this.registerMetrics(vm, configuredCpus, configuredMemory);
    } catch (error) {
      await vm.close();
      throw error;
    }
    this.vm = vm;
    return vm;
  }

  private registerMetrics(vm: VM, cpus: number, memory: string): void {
    const metricsDirectory = process.env.GONDOLIN_METRICS_DIR;
    if (!metricsDirectory) return;
    const pid = vm.getHostPid();
    if (pid === null) throw new Error("Gondolin VM runner PID is unavailable");
    fs.mkdirSync(metricsDirectory, { recursive: true, mode: 0o700 });
    fs.chmodSync(metricsDirectory, 0o700);
    const safeId = vm.id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const target = path.join(metricsDirectory, `${safeId}.json`);
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({
      id: vm.id,
      label: this.options.sessionLabel ?? "pi-playwright-mcp",
      pid,
      ownerPid: process.pid,
      cpus,
      memoryBytes: memoryBytes(memory),
    })}\n`, { mode: 0o600 });
    fs.renameSync(temporary, target);
    this.metricsRegistration = target;
  }
}
