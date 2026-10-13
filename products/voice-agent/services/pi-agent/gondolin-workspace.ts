import { constants as fsConstants, existsSync } from "node:fs";
import path from "node:path";

import {
  type BashOperations,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type EditOperations,
  type ReadOperations,
  type WriteOperations,
} from "@earendil-works/pi-coding-agent";
import { ReadonlyProvider, RealFSProvider, VM } from "@earendil-works/gondolin";

const GUEST_WORKSPACE = "/workspace";
export const GUEST_SKILLS = "/skills";

function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function toGondolinPath(localCwd: string, localPath: string): string {
  const relativePath = path.relative(localCwd, localPath);
  if (relativePath === "") return GUEST_WORKSPACE;
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`path escapes workspace: ${localPath}`);
  }
  return path.posix.join(GUEST_WORKSPACE, ...relativePath.split(path.sep));
}

function createReadOperations(vm: VM, localCwd: string): ReadOperations {
  return {
    readFile: async (filePath) => vm.fs.readFile(toGondolinPath(localCwd, filePath)),
    access: async (filePath) => {
      await vm.fs.access(toGondolinPath(localCwd, filePath), { mode: fsConstants.R_OK });
    },
    detectImageMimeType: async (filePath) => {
      const guestPath = toGondolinPath(localCwd, filePath);
      try {
        const result = await vm.exec([
          "/bin/sh",
          "-lc",
          `file --mime-type -b ${shQuote(guestPath)}`,
        ]);
        if (!result.ok) return null;
        const mimeType = result.stdout.trim();
        return ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mimeType)
          ? mimeType
          : null;
      } catch {
        return null;
      }
    },
  };
}

function createWriteOperations(vm: VM, localCwd: string): WriteOperations {
  return {
    writeFile: async (filePath, content) => {
      const guestPath = toGondolinPath(localCwd, filePath);
      await vm.fs.mkdir(path.posix.dirname(guestPath), { recursive: true });
      await vm.fs.writeFile(guestPath, content);
    },
    mkdir: async (directory) => {
      await vm.fs.mkdir(toGondolinPath(localCwd, directory), { recursive: true });
    },
  };
}

function createEditOperations(vm: VM, localCwd: string): EditOperations {
  const read = createReadOperations(vm, localCwd);
  const write = createWriteOperations(vm, localCwd);
  return {
    readFile: read.readFile,
    writeFile: write.writeFile,
    access: async (filePath) => {
      await vm.fs.access(toGondolinPath(localCwd, filePath), {
        mode: fsConstants.R_OK | fsConstants.W_OK,
      });
    },
  };
}

function createBashOperations(vm: VM, localCwd: string): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout }) => {
      const guestCwd = toGondolinPath(localCwd, cwd);
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      let timedOut = false;
      const timer = timeout && timeout > 0
        ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeout * 1_000)
        : undefined;
      try {
        const process = vm.exec(["/bin/bash", "-lc", command], {
          cwd: guestCwd,
          signal: controller.signal,
          stdout: "pipe",
          stderr: "pipe",
        });
        for await (const chunk of process.output()) onData(chunk.data);
        const result = await process;
        return { exitCode: result.exitCode };
      } catch (error) {
        if (signal?.aborted) throw new Error("aborted");
        if (timedOut) throw new Error(`timeout:${timeout}`);
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

export function createGondolinTools(vm: VM, localCwd: string) {
  return [
    createReadTool(localCwd, { operations: createReadOperations(vm, localCwd) }),
    createWriteTool(localCwd, { operations: createWriteOperations(vm, localCwd) }),
    createEditTool(localCwd, { operations: createEditOperations(vm, localCwd) }),
    createBashTool(localCwd, {
      operations: createBashOperations(vm, localCwd),
      exposeSessionEnvironment: false,
    }),
  ];
}

type GondolinWorkspaceOptions = {
  imagePath: string;
  localCwd: string;
  skillsDir: string;
  sessionLabel?: string;
};

export class GondolinWorkspace {
  private constructor(
    private readonly vm: VM,
    private readonly localCwd: string,
  ) {}

  static async create(options: GondolinWorkspaceOptions): Promise<GondolinWorkspace> {
    if (!existsSync(options.imagePath)) {
      throw new Error(`Missing Gondolin assets: ${options.imagePath}`);
    }
    if (!existsSync(options.skillsDir)) {
      throw new Error(`Missing skills directory: ${options.skillsDir}`);
    }
    const vm = await VM.create({
      sandbox: { imagePath: options.imagePath },
      vfs: {
        mounts: {
          [GUEST_WORKSPACE]: new RealFSProvider(options.localCwd),
          [GUEST_SKILLS]: new ReadonlyProvider(new RealFSProvider(options.skillsDir)),
        },
      },
      memory: "2G",
      cpus: 2,
      sessionLabel: options.sessionLabel ?? "pi-voice",
    });
    return new GondolinWorkspace(vm, options.localCwd);
  }

  tools() {
    return createGondolinTools(this.vm, this.localCwd);
  }

  async close(): Promise<void> {
    await this.vm.close();
  }
}
