import { basename, posix } from "node:path";
import { randomUUID } from "node:crypto";
import type { Context } from "@earendil-works/chord/context";
import {
  ExecutionError, FileError, err, ok,
  type BinaryReader, type DirReader, type ExecutionEnv, type FileInfo,
  type FileWatcher, type Result, type ShellExecOptions, type ShellExecResult,
  type TextLineReader, type WatchChange, type WatchTarget,
} from "@earendil-works/pi-durable/env";
import { GondolinSession } from "@agent-workload-platform/gondolin-session";

type FsError = Result<never, FileError>;
function fileFailure(error: unknown, path?: string): FsError {
  const message = String((error as Error)?.message ?? error);
  const code = (error as NodeJS.ErrnoException)?.code
    ?? message.match(/\b(?:ENOENT|EACCES|EPERM|ENOTDIR|EISDIR)\b/u)?.[0];
  return err(new FileError(
    code === "ENOENT" ? "not_found" : code === "EACCES" || code === "EPERM" ? "permission_denied"
      : code === "ENOTDIR" ? "not_directory" : code === "EISDIR" ? "is_directory" : "unknown",
    `Guest file operation failed: ${code ?? "unknown"}`, path,
  ));
}

/** Pi Durable stays on the host; its file and shell capabilities operate in one task VM. */
export class GondolinExecutionEnv implements ExecutionEnv {
  readonly id: string;
  cwd = "/workspace";

  constructor(private readonly session: GondolinSession, taskId: string) {
    this.id = `gondolin:${taskId}`;
  }

  private path(value: string): string { return posix.resolve(this.cwd, value); }
  private async file<T>(path: string, fn: () => Promise<T>): Promise<Result<T, FileError>> {
    try { return ok(await fn()); } catch (error) { return fileFailure(error, path); }
  }
  private info(path: string, stat: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean; size: number; mtimeMs: number }): FileInfo {
    return { name: basename(path), path, kind: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file",
      size: stat.size, mtimeMs: stat.mtimeMs };
  }
  async absolutePath(path: string): Promise<Result<string, FileError>> { return ok(this.path(path)); }
  async joinPath(parts: string[]): Promise<Result<string, FileError>> { return ok(posix.join(...parts)); }
  async readTextFile(path: string): Promise<Result<string, FileError>> {
    const target = this.path(path);
    return this.file(target, async () => (await this.session.filesystem()).readFile(target, { encoding: "utf8" }));
  }
  async readBinaryFile(path: string): Promise<Result<Uint8Array, FileError>> {
    const target = this.path(path);
    return this.file(target, async () => (await this.session.filesystem()).readFile(target));
  }
  async readTextLines(path: string, options?: { maxLines?: number }): Promise<Result<string[], FileError>> {
    const result = await this.readTextFile(path);
    if (!result.ok) return result;
    const lines = result.value.split(/\r?\n/u);
    if (lines.at(-1) === "") lines.pop();
    return ok(options?.maxLines === undefined ? lines : lines.slice(0, options.maxLines));
  }
  async openTextLineReader(path: string): Promise<Result<TextLineReader, FileError>> {
    const result = await this.readTextFile(path);
    if (!result.ok) return result;
    const lines = result.value.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
    let cursor = 0;
    return ok({
      readLine: async () => {
        const line = lines[cursor++];
        return ok(line === undefined ? undefined : { text: line.endsWith("\n") ? line.slice(0, -1) : line,
          terminated: line.endsWith("\n") });
      },
      close: async () => {},
    });
  }
  async openBinaryReader(path: string, options?: { noFollow?: boolean }): Promise<Result<BinaryReader, FileError>> {
    const target = this.path(path);
    if (options?.noFollow) {
      const link = await this.session.run(["/bin/sh", "-c", "test -L \"$1\"", "sh", target]);
      if (link.exitCode === 0) return err(new FileError("invalid", "symlink", target));
    }
    const info = await this.fileInfo(target);
    if (!info.ok) return info;
    if (info.value.kind !== "file") return err(new FileError("is_directory", "not a regular file", target));
    const content = await this.readBinaryFile(target);
    if (!content.ok) return content;
    const bytes = content.value;
    return ok({
      info: async () => ok(info.value),
      read: async (offset, length) => ok(bytes.slice(offset, offset + length)),
      scanLines: async ({ startLine, endLine }) => {
        const starts = [0];
        for (let i = 0; i < bytes.length; i++) if (bytes[i] === 10) starts.push(i + 1);
        const start = starts[startLine] ?? bytes.length;
        const last = endLine === undefined ? bytes.length : starts[endLine] ?? bytes.length;
        const end = last > start && bytes[last - 1] === 10 ? last - 1 : last;
        const selected = new TextDecoder().decode(bytes.slice(start, end));
        const first = selected.split("\n", 1)[0] ?? "";
        const lastStart = selected.lastIndexOf("\n") + 1;
        return ok({ newlines: starts.length - 1, start, end, firstLineEnd: start + Buffer.byteLength(first),
          lastLineStart: start + Buffer.byteLength(selected.slice(0, lastStart)),
          selectedBytes: Buffer.byteLength(selected), firstLineBytes: Buffer.byteLength(first) });
      },
      close: async () => {},
    });
  }
  async writeFile(path: string, content: string | Uint8Array): Promise<Result<void, FileError>> {
    const target = this.path(path);
    return this.file(target, async () => (await this.session.filesystem()).writeFile(target, content));
  }
  async appendFile(path: string, content: string | Uint8Array): Promise<Result<void, FileError>> {
    const target = this.path(path);
    return this.file(target, async () => {
      const result = await this.session.run(["/bin/sh", "-c", "cat >> \"$1\"", "sh", target],
        { input: Buffer.from(content) });
      if (!result.ok) throw new Error(result.stderr);
    });
  }
  async truncateFile(path: string, size: number): Promise<Result<void, FileError>> {
    const target = this.path(path);
    return this.file(target, async () => {
      const result = await this.session.run(["truncate", "-s", String(size), "--", target]);
      if (!result.ok) throw new Error(result.stderr);
    });
  }
  async flushFile(path: string): Promise<Result<void, FileError>> {
    const target = this.path(path);
    const info = await this.fileInfo(target);
    if (!info.ok) return info;
    return this.file(target, async () => {
      const result = await this.session.run(["/bin/sync"]);
      if (!result.ok) throw new Error(result.stderr);
    });
  }
  async renameFile(sourcePath: string, destinationPath: string): Promise<Result<void, FileError>> {
    const source = this.path(sourcePath);
    return this.file(source, async () => (await this.session.filesystem()).rename(source, this.path(destinationPath)));
  }
  async fileInfo(path: string): Promise<Result<FileInfo, FileError>> {
    const target = this.path(path);
    return this.file(target, async () => this.info(target, await (await this.session.filesystem()).stat(target)));
  }
  async listDir(path: string): Promise<Result<FileInfo[], FileError>> {
    const target = this.path(path);
    return this.file(target, async () => {
      const fs = await this.session.filesystem();
      const names = await fs.listDir(target);
      return Promise.all(names.map(async (name) => {
        const child = posix.join(target, name);
        return this.info(child, await fs.stat(child));
      }));
    });
  }
  async openDirReader(path: string): Promise<Result<DirReader, FileError>> {
    const result = await this.listDir(path);
    if (!result.ok) return result;
    let cursor = 0;
    return ok({ next: async (maxEntries) => {
      const entries = result.value.slice(cursor, cursor + maxEntries);
      cursor += entries.length;
      return ok({ entries, done: cursor >= result.value.length });
    }, close: async () => {} });
  }
  async watch(_targets: readonly WatchTarget[], _onChange: (change: WatchChange) => void): Promise<Result<FileWatcher, FileError>> {
    return err(new FileError("not_supported", "Gondolin file watch is unavailable"));
  }
  async canonicalPath(path: string): Promise<Result<string, FileError>> {
    const target = this.path(path);
    return this.file(target, async () => {
      const result = await this.session.run(["realpath", "--", target]);
      if (!result.ok) throw new Error(result.stderr);
      return result.stdout.trim();
    });
  }
  async exists(path: string): Promise<Result<boolean, FileError>> {
    const info = await this.fileInfo(path);
    return info.ok ? ok(true) : info.error.code === "not_found" ? ok(false) : info;
  }
  async createDir(path: string, options?: { recursive?: boolean }): Promise<Result<void, FileError>> {
    const target = this.path(path);
    return this.file(target, async () => (await this.session.filesystem()).mkdir(target, options));
  }
  async remove(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<Result<void, FileError>> {
    const target = this.path(path);
    return this.file(target, async () => (await this.session.filesystem()).deleteFile(target, options));
  }
  async createTempDir(prefix?: string): Promise<Result<string, FileError>> {
    const target = posix.join("/tmp", `${prefix ?? "pi-"}${randomUUID()}`);
    const created = await this.createDir(target);
    return created.ok ? ok(target) : created;
  }
  async createTempFile(options?: { prefix?: string; suffix?: string }): Promise<Result<string, FileError>> {
    const target = posix.join("/tmp", `${options?.prefix ?? "pi-"}${randomUUID()}${options?.suffix ?? ""}`);
    const written = await this.writeFile(target, "");
    return written.ok ? ok(target) : written;
  }
  async exec(command: string | readonly string[], options: ShellExecOptions | undefined, context: Context): Promise<Result<ShellExecResult, ExecutionError>> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    context.abortSignal?.addEventListener("abort", abort, { once: true });
    const timer = options?.timeout ? setTimeout(abort, options.timeout) : undefined;
    try {
      const requestedCwd = options?.cwd ?? this.cwd;
      const guestCwd = requestedCwd.startsWith("/workspace") ? requestedCwd : this.path(requestedCwd);
      const args = typeof command === "string" ? ["/bin/bash", "-c", command] : command;
      const result = await this.session.run(args, { cwd: guestCwd, signal: controller.signal,
        env: options?.env });
      if (result.stdout) options?.onOutput?.(result.stdout, context, { stream: "stdout" });
      if (result.stderr) options?.onOutput?.(result.stderr, context, { stream: "stderr" });
      return ok({ exitCode: result.exitCode });
    } catch (error) {
      return err(new ExecutionError(context.abortSignal?.aborted ? "aborted" : controller.signal.aborted ? "timeout" : "spawn_error", String(error)));
    } finally {
      if (timer) clearTimeout(timer);
      context.abortSignal?.removeEventListener("abort", abort);
    }
  }
  async cleanup(): Promise<void> {}
}
