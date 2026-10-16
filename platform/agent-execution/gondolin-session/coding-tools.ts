import path from "node:path";

import {
  type BashOperations,
  createCodingTools,
  type EditOperations,
  type ReadOperations,
  type WriteOperations,
} from "@earendil-works/pi-coding-agent";
import type { VM } from "@earendil-works/gondolin";

const guestWorkspace = "/workspace";

function guestPath(localCwd: string, localPath: string): string {
  const relativePath = path.relative(localCwd, localPath);
  if (relativePath === "") return guestWorkspace;
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`path escapes workspace: ${localPath}`);
  }
  return path.posix.join(guestWorkspace, ...relativePath.split(path.sep));
}

function readOperations(vm: VM, localCwd: string): ReadOperations {
  return {
    readFile: async (filePath) => vm.fs.readFile(guestPath(localCwd, filePath)),
    access: async (filePath) => vm.fs.access(guestPath(localCwd, filePath)),
    detectImageMimeType: async (filePath) => {
      const extension = path.extname(filePath).toLowerCase();
      if (extension === ".png") return "image/png";
      if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
      if (extension === ".gif") return "image/gif";
      if (extension === ".webp") return "image/webp";
      return null;
    },
  };
}

function writeOperations(vm: VM, localCwd: string): WriteOperations {
  return {
    writeFile: async (filePath, content) => {
      const destination = guestPath(localCwd, filePath);
      await vm.fs.mkdir(path.posix.dirname(destination), { recursive: true });
      await vm.fs.writeFile(destination, content);
    },
    mkdir: async (directory) => vm.fs.mkdir(guestPath(localCwd, directory), { recursive: true }),
  };
}

function editOperations(vm: VM, localCwd: string): EditOperations {
  const read = readOperations(vm, localCwd);
  const write = writeOperations(vm, localCwd);
  return {
    readFile: read.readFile,
    writeFile: write.writeFile,
    access: read.access,
  };
}

function bashOperations(vm: VM, localCwd: string): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout }) => {
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
        const process = vm.exec(["/bin/bash", "-lc", command], {
          cwd: guestPath(localCwd, cwd),
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
        signal?.removeEventListener("abort", abort);
      }
    },
  };
}

export function createGondolinCodingTools(
  vm: VM,
  localCwd: string,
): ReturnType<typeof createCodingTools> {
  return createCodingTools(localCwd, {
    read: { operations: readOperations(vm, localCwd) },
    write: { operations: writeOperations(vm, localCwd) },
    edit: { operations: editOperations(vm, localCwd) },
    bash: {
      operations: bashOperations(vm, localCwd),
      exposeSessionEnvironment: false,
    },
  });
}
