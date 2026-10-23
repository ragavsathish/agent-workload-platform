/**
 * Pi's standard file and shell operations routed through Gondolin.
 *
 * Adapted from Pi's Gondolin example for pi-coding-agent 1.2.0:
 * packages/coding-agent/examples/extensions/gondolin/index.ts
 */
import path from "node:path";

import type { VM } from "@earendil-works/gondolin";
import {
  type BashOperations,
  createCodingTools,
  type EditOperations,
  type ReadOperations,
  type WriteOperations,
} from "@earendil-works/pi-coding-agent";

type GuestFiles = VM["fs"];
type GuestProcesses = Pick<VM, "exec">;
type ResolveWorkingDirectory = (cwd: string) => string;
type ImageMimeType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
type ToolOperations = {
  read: ReadOperations;
  write: WriteOperations;
  edit: EditOperations;
  bash: BashOperations;
};

const guestWorkspace = "/workspace";
// Login shells reset the image PATH, hiding tools such as /opt/flutter/bin/flutter.
const guestShell = ["/bin/bash", "-c"] as const;
const imageMimeTypes = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
} satisfies Readonly<Record<string, ImageMimeType>>;
const bashAbortedMessage = "aborted";

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error(bashAbortedMessage);
}

function imageMimeType(filePath: string): ImageMimeType | null {
  const extension = path.posix.extname(filePath).toLowerCase() as keyof typeof imageMimeTypes;
  return imageMimeTypes[extension] ?? null;
}

function isInside(root: string, value: string): boolean {
  const relative = path.relative(root, value);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Translate Pi's host-side runtime cwd into the guest workspace. */
function createUserBashCwdResolver(hostWorkspace: string, localCwd?: string): ResolveWorkingDirectory {
  return (cwd) => {
    if (isInside(hostWorkspace, cwd)) {
      return path.posix.resolve(guestWorkspace, path.relative(hostWorkspace, cwd));
    }
    if (localCwd && isInside(localCwd, cwd)) {
      return path.posix.resolve(guestWorkspace, path.relative(localCwd, cwd));
    }
    return path.posix.resolve("/", cwd);
  };
}

function readOperations(files: GuestFiles, resolvePath: ResolveWorkingDirectory): ReadOperations {
  return {
    readFile: async (filePath) => files.readFile(resolvePath(filePath)),
    access: async (filePath) => files.access(resolvePath(filePath)),
    detectImageMimeType: async (filePath) => imageMimeType(filePath),
  };
}

function writeOperations(files: GuestFiles, resolvePath: ResolveWorkingDirectory): WriteOperations {
  return {
    writeFile: async (filePath, content) => {
      const guestPath = resolvePath(filePath);
      await files.mkdir(path.posix.dirname(guestPath), { recursive: true });
      await files.writeFile(guestPath, content, { encoding: "utf8" });
    },
    mkdir: async (directory) => files.mkdir(resolvePath(directory), { recursive: true }),
  };
}

function editOperations(read: ReadOperations, write: WriteOperations): EditOperations {
  return { readFile: read.readFile, writeFile: write.writeFile, access: read.access };
}

function bashOperations(
  processes: GuestProcesses,
  resolveCwd: ResolveWorkingDirectory,
): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout }) => {
      assertActive(signal);
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      let timedOut = false;
      const timer = timeout && timeout > 0
        ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeout * 1_000)
        : undefined;
      try {
        const process = processes.exec([...guestShell, command], {
          cwd: resolveCwd(cwd),
          signal: controller.signal,
          stdout: "pipe",
          stderr: "pipe",
        });
        for await (const chunk of process.output()) onData(chunk.data);
        return { exitCode: (await process).exitCode };
      } catch (error) {
        if (signal?.aborted) throw new Error(bashAbortedMessage);
        if (timedOut) throw new Error(`timeout:${timeout}`);
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    },
  };
}

function composeToolOperations(vm: VM, hostWorkspace?: string, localCwd?: string): ToolOperations {
  const resolvePath = hostWorkspace || localCwd
    ? createUserBashCwdResolver(hostWorkspace ?? localCwd!, localCwd)
    : (value: string) => value;
  const read = readOperations(vm.fs, resolvePath);
  const write = writeOperations(vm.fs, resolvePath);
  return {
    read,
    write,
    edit: editOperations(read, write),
    bash: bashOperations(vm, resolvePath),
  };
}

export function createGondolinBashOperations(vm: VM, localCwd: string): BashOperations {
  return bashOperations(vm, createUserBashCwdResolver(localCwd));
}

export function createGondolinCodingTools(vm: VM, hostWorkspace?: string, localCwd?: string): ReturnType<typeof createCodingTools> {
  const operations = composeToolOperations(vm, hostWorkspace, localCwd);
  return createCodingTools(guestWorkspace, {
    read: { operations: operations.read },
    bash: {
      operations: operations.bash,
      exposeSessionEnvironment: false,
    },
    edit: { operations: operations.edit },
    write: { operations: operations.write },
  });
}
