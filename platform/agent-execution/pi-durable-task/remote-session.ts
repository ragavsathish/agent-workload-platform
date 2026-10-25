import { randomUUID } from "node:crypto";
import { chmod, mkdir, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AgentEvent } from "@earendil-works/pi-durable";
import type { DurableTaskSession } from "./runtime.js";
import { configureTelemetry } from "@agent-workload-platform/otel";

const MAX_CLIENT_BYTES = 65_536;
const sessions = new Map<string, RemoteTaskBridge>();
const telemetry = configureTelemetry("pi-durable-owner");
type Request = { id?: string; type?: string; message?: string; streamingBehavior?: string };

function send(socket: Socket, value: object): void {
  if (!socket.destroyed) socket.write(`${JSON.stringify(value)}\n`);
}

/** Keeps a native Pi Durable conversation attachable after its initial task result. */
export class RemoteTaskBridge {
  private server?: Server;
  private readonly clients = new Set<Socket>();
  private timer?: NodeJS.Timeout;
  private closing?: Promise<void>;
  private active = 0;
  private lastActivity = Date.now();
  private lastAnswer = "";

  constructor(
    private readonly taskId: string,
    private readonly session: DurableTaskSession,
    private readonly socketDirectory: string,
    private readonly idleSeconds: number,
    private readonly disposeEnvironment: () => Promise<void>,
  ) {}

  get path(): string { return join(this.socketDirectory, `${this.taskId}.sock`); }

  async start(): Promise<void> {
    await mkdir(this.socketDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.socketDirectory, 0o700);
    if (Buffer.byteLength(this.path) >= 104) throw new Error("durable task socket path is too long");
    await rm(this.path, { force: true });
    this.server = createServer((socket) => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.path, resolve);
    });
    await chmod(this.path, 0o600);
    sessions.set(this.taskId, this);
  }

  initialStarted(): void { this.active += 1; }
  initialSettled(text: string): void {
    this.active -= 1;
    this.lastAnswer = text;
    this.lastActivity = Date.now();
    this.broadcast({ type: "agent_settled" });
    this.timer = setInterval(() => {
      if (this.clients.size === 0 && this.active === 0
          && Date.now() - this.lastActivity >= this.idleSeconds * 1_000) {
        void this.close();
      }
    }, 250);
  }

  event(event: AgentEvent): void {
    if (event.type === "message_update") {
      for (const change of event.changes) {
        if (change.type === "text_delta") this.broadcast({ type: "message_update", assistantMessageEvent: change });
      }
    }
    if (event.type === "turn_start" || event.type === "turn_end") this.broadcast({ type: event.type });
  }

  private broadcast(value: object): void {
    for (const socket of this.clients) send(socket, value);
  }

  private accept(socket: Socket): void {
    this.clients.add(socket);
    this.lastActivity = Date.now();
    telemetry.record("remote.attach");
    send(socket, { type: "remote_attached", taskId: this.taskId });
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (Buffer.byteLength(buffer) > MAX_CLIENT_BYTES) { socket.destroy(); return; }
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        this.lastActivity = Date.now();
        try { void this.handle(socket, JSON.parse(line) as Request).catch((error: unknown) => {
          send(socket, { type: "response", success: false, error: String(error) });
        }); } catch { send(socket, { type: "response", success: false, error: "invalid JSON" }); }
      }
    });
    socket.on("close", () => this.clients.delete(socket));
    socket.on("error", () => this.clients.delete(socket));
  }

  private async handle(socket: Socket, request: Request): Promise<void> {
    const { id, type } = request;
    if (type === "get_state") {
      send(socket, { id, type: "response", command: type, success: true,
        data: { isStreaming: this.active > 0, messageCount: 0 } });
      return;
    }
    if (type === "get_last_assistant_text") {
      send(socket, { id, type: "response", command: type, success: true, data: { text: this.lastAnswer } });
      return;
    }
    if (type === "abort") {
      await this.session.conversation.abort(BACKGROUND_CONTEXT);
      send(socket, { id, type: "response", command: type, success: true });
      return;
    }
    if (type !== "prompt" || typeof request.message !== "string"
        || !request.message.trim() || request.message.length > 20_000) {
      send(socket, { id, type: "response", success: false, error: "invalid command" });
      return;
    }
    this.active += 1;
    try {
      const submission = await this.session.submitInput(request.message, id ?? randomUUID(),
        request.streamingBehavior === "steer" ? "steer" : "followUp");
      send(socket, { id, type: "response", command: type, success: true,
        data: { disposition: request.streamingBehavior === "steer" ? "steered" : "started" } });
      const answer = await this.session.waitForAnswer(submission);
      this.lastAnswer = answer.text;
      telemetry.record("remote.prompt");
      this.broadcast({ type: "agent_settled" });
    } catch (error) {
      telemetry.record("remote.prompt", { outcome: "error" });
      this.broadcast({ type: "agent_settled", error: String(error) });
    } finally {
      this.active -= 1;
      this.lastActivity = Date.now();
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      if (this.timer) clearInterval(this.timer);
      for (const socket of this.clients) socket.destroy();
      if (this.server) await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      sessions.delete(this.taskId);
      try { await this.session.close(); }
      finally {
        await this.disposeEnvironment();
        await rm(this.path, { force: true });
      }
    })();
    return this.closing;
  }
}

export async function closeTaskSessions(): Promise<void> {
  await Promise.all([...sessions.values()].map((session) => session.close()));
}
