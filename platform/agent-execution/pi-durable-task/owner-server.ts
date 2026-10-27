import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createConnection, createServer, type Socket } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { acquireStoreOwner } from "./lease.js";
import { DurableTaskOwner, type ProductInput, type ValidationInput } from "./owner.js";

type Request = {
  id: string;
  command: "submit" | "get" | "get_many" | "describe" | "describe_product" | "cancel_product"
    | "progress" | "list_native" | "abort" | "retry" | "inspect";
  taskId?: string;
  taskIds?: string[];
  identity?: string;
  limit?: number;
  after?: number;
  requestId?: string;
  input?: ValidationInput | ProductInput;
};

// Daily journal task inputs carry up to 200 KB of bounded, redacted source messages.
const MAX_REQUEST_BYTES = 256_000;
const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function validRequest(value: unknown): value is Request {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && item.id.length <= 100
    && ["submit", "get", "get_many", "describe", "describe_product", "cancel_product",
      "progress", "list_native", "abort", "retry", "inspect"].includes(String(item.command));
}

function send(socket: Socket, value: object): void {
  if (!socket.destroyed) socket.write(`${JSON.stringify(value)}\n`);
}

export async function serveOwner(storagePath: string, socketPath: string, restartLimit = 5): Promise<void> {
  process.umask(0o077);
  await mkdir(dirname(storagePath), { recursive: true, mode: 0o700 });
  await chmod(dirname(storagePath), 0o700);
  for (const file of [storagePath, `${storagePath}-wal`, `${storagePath}-shm`]) {
    await chmod(file, 0o600).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
  await chmod(dirname(socketPath), 0o700);
  if (Buffer.byteLength(socketPath) >= 104) throw new Error("owner socket path is too long");
  const release = await acquireStoreOwner(storagePath);
  let owner: DurableTaskOwner | undefined;
  try {
    owner = await DurableTaskOwner.open(storagePath, restartLimit);
    await rm(socketPath, { force: true });
    const server = createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        if (Buffer.byteLength(buffer) > MAX_REQUEST_BYTES) return socket.destroy();
        for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          void (async () => {
            const request: unknown = JSON.parse(line);
            if (!validRequest(request)) throw new Error("invalid owner request");
            let data: unknown;
            switch (request.command) {
              case "submit":
                if (typeof request.requestId !== "string" || !TASK_ID.test(request.requestId)
                    || !request.input
                    || !("kind" in request.input
                      ? ["agent-run", "song-lyrics", "song-render", "digital-twin-journal", "digital-twin-classify", "digital-twin-daily-journal"].includes(request.input.kind)
                        && request.input.requestId === request.requestId
                        && !!request.input.params && typeof request.input.params === "object"
                        && !Array.isArray(request.input.params)
                      : typeof request.input.text === "string" && request.input.text.length <= 2_000
                        && Number.isInteger(request.input.holdMs)
                        && request.input.holdMs >= 0 && request.input.holdMs <= 10_000)) {
                  throw new Error("invalid task input");
                }
                data = { task_id: await owner!.submit(request.requestId, request.input) };
                break;
              case "get":
                if (typeof request.taskId !== "string") throw new Error("task ID required");
                data = await owner!.get(request.taskId);
                break;
              case "get_many":
                if (!Array.isArray(request.taskIds) || request.taskIds.length > 100
                    || request.taskIds.some((id) => typeof id !== "string" || !TASK_ID.test(id))) {
                  throw new Error("up to 100 task IDs required");
                }
                data = await owner!.getMany(request.taskIds);
                break;
              case "describe":
                if (typeof request.taskId !== "string" || !TASK_ID.test(request.taskId)) throw new Error("task ID required");
                data = await owner!.describe(request.taskId);
                break;
              case "describe_product":
                if (typeof request.taskId !== "string" || !TASK_ID.test(request.taskId)) throw new Error("task ID required");
                data = await owner!.describeProduct(request.taskId);
                break;
              case "cancel_product":
                if (typeof request.taskId !== "string" || !TASK_ID.test(request.taskId)
                    || typeof request.identity !== "string" || request.identity.length < 3
                    || request.identity.length > 320) throw new Error("task ID and owner identity required");
                await owner!.cancelProduct(request.taskId, request.identity);
                data = { cancelled: true };
                break;
              case "progress":
                if (typeof request.taskId !== "string" || !TASK_ID.test(request.taskId)
                    || !Number.isInteger(request.after) || request.after! < 0
                    || !Number.isInteger(request.limit) || request.limit! < 1 || request.limit! > 100) {
                  throw new Error("task ID and bounded progress cursor required");
                }
                data = await owner!.progress(request.taskId, request.after, request.limit);
                break;
              case "list_native":
                if (typeof request.identity !== "string" || request.identity.length < 3 || request.identity.length > 320
                    || !Number.isInteger(request.limit) || request.limit! < 1 || request.limit! > 100) {
                  throw new Error("bounded owner identity and limit required");
                }
                data = await owner!.listNative(request.identity, request.limit);
                break;
              case "abort":
                if (typeof request.taskId !== "string") throw new Error("task ID required");
                data = { disposition: await owner!.abort(request.taskId) };
                break;
              case "retry":
                if (typeof request.taskId !== "string") throw new Error("task ID required");
                await owner!.retry(request.taskId);
                data = { retried: true };
                break;
              case "inspect":
                data = await owner!.inspect();
                break;
            }
            send(socket, { id: request.id, success: true, data });
          })().catch((error: unknown) => {
            send(socket, { success: false, error: String(error) });
          });
        }
      });
      socket.on("error", () => socket.destroy());
    });
    let httpServer: ReturnType<typeof createHttpServer> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, resolve);
      });
      await chmod(socketPath, 0o600);
      const tokenPath = process.env.PI_DURABLE_OWNER_TOKEN_FILE;
      if (tokenPath) {
        const token = (await readFile(tokenPath, "utf8")).trim();
        if (token.length < 32) throw new Error("owner transport token is too short");
        httpServer = createHttpServer((request, response) => {
          const supplied = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
          const valid = supplied.length === token.length
            && timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
          if (!valid) { response.writeHead(401).end(); return; }
          if (request.method !== "POST" || request.url !== "/private/task") {
            response.writeHead(404).end(); return;
          }
          let body = "";
          request.on("data", (chunk: Buffer) => {
            body += chunk.toString();
            if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) request.destroy();
          });
          request.on("end", () => {
            const socket = createConnection(socketPath);
            let answered = false;
            let replyBuffer = "";
            socket.on("data", (chunk) => {
              if (answered) return;
              replyBuffer += chunk.toString();
              const newline = replyBuffer.indexOf("\n");
              if (newline < 0) return;
              answered = true;
              response.writeHead(200, { "Content-Type": "application/json" })
                .end(replyBuffer.slice(0, newline));
              socket.end();
            });
            socket.on("error", () => { if (!answered) response.writeHead(502).end(); });
            socket.on("connect", () => socket.write(`${body.trim()}\n`));
          });
        });
        await new Promise<void>((resolve, reject) => {
          httpServer!.once("error", reject);
          httpServer!.listen(Number(process.env.PI_DURABLE_OWNER_PORT ?? 9448), "127.0.0.1", resolve);
        });
      }
      process.stdout.write(`pi-durable-owner ready ${socketPath}\n`);
      await new Promise<void>((resolve) => {
        process.once("SIGTERM", resolve);
        process.once("SIGINT", resolve);
      });
    } finally {
      if (httpServer) await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(socketPath, { force: true });
    }
  } finally {
    await owner?.close();
    await release();
  }
}

if (process.argv[1]?.endsWith("owner-server.js")) {
  const storagePath = process.env.PI_DURABLE_OWNER_STORE
    ?? join(homedir(), ".pi", "agent", "sessions", "durable-owner.sqlite");
  const socketPath = process.env.PI_DURABLE_OWNER_SOCKET
    ?? join("/tmp", `awp-pi-owner-${process.getuid?.() ?? 0}`, "owner.sock");
  void serveOwner(storagePath, socketPath,
    Number(process.env.PI_DURABLE_OWNER_RESTART_LIMIT ?? 5)).catch((error: unknown) => {
    process.stderr.write(`pi-durable-owner: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
