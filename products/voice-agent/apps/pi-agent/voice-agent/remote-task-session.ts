import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MAX_RECORD_BYTES = 1_000_000;

type JsonRecord = Record<string, unknown>;
type SequencedRecord = { record: JsonRecord; sequence: number };
type PendingRequest = {
  resolve: (value: SequencedRecord) => void;
  reject: (error: Error) => void;
};

export type RemoteTaskState = {
  taskId: string;
  isStreaming: boolean;
  messageCount: number;
};

export class RemoteTaskSession {
  private socket?: Socket;
  private taskId?: string;
  private buffer = "";
  private pending = new Map<string, PendingRequest>();
  private listeners = new Set<(record: JsonRecord) => void>();
  private failureListeners = new Set<(error: Error) => void>();
  private sequence = 0;
  private lastSettled?: SequencedRecord;

  constructor(
    private readonly socketDirectory: string,
    private readonly timeoutMs: number,
  ) {}

  get attachedTaskId(): string | undefined {
    return this.taskId;
  }

  async attach(taskId: string): Promise<RemoteTaskState> {
    if (!TASK_ID.test(taskId)) throw new Error("task ID must be a lowercase UUID");
    await this.detach();
    const socket = createConnection(join(this.socketDirectory, `${taskId}.sock`));
    socket.setNoDelay(true);
    this.socket = socket;
    this.taskId = taskId;
    socket.on("data", (chunk) => this.consume(socket, chunk));
    socket.on("error", (error) => this.fail(error, socket));
    socket.on("close", () => this.fail(new Error("remote task session closed"), socket));
    await this.waitFor(
      (record) => record.type === "remote_attached" && record.taskId === taskId,
      "remote task session is unavailable",
    );
    return this.state();
  }

  async state(): Promise<RemoteTaskState> {
    const taskId = this.taskId;
    if (!taskId) throw new Error("no remote task session is attached");
    const { record: response } = await this.request({ type: "get_state" });
    const data = response.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("remote task returned invalid state");
    }
    const state = data as JsonRecord;
    return {
      taskId,
      isStreaming: state.isStreaming === true,
      messageCount: typeof state.messageCount === "number" ? state.messageCount : 0,
    };
  }

  async send(message: string, onDelta?: (delta: string) => void): Promise<string> {
    const prompt = message.trim();
    if (!prompt || prompt.length > 20_000) throw new Error("invalid remote task message");
    const state = await this.state();
    let capture = !state.isStreaming;
    let sawCurrentTurnEnd = false;
    const unsubscribe = this.subscribe((record) => {
      if (state.isStreaming && record.type === "turn_end") sawCurrentTurnEnd = true;
      if (
        state.isStreaming
        && record.type === "turn_start"
        && sawCurrentTurnEnd
      ) capture = true;
      if (!capture || record.type !== "message_update") return;
      const event = record.assistantMessageEvent;
      if (!event || typeof event !== "object" || Array.isArray(event)) return;
      const update = event as JsonRecord;
      if (update.type === "text_delta" && typeof update.delta === "string") {
        onDelta?.(update.delta);
      }
    });
    try {
      const promptResponse = await this.request({
        type: "prompt",
        message: prompt,
        ...(state.isStreaming ? { streamingBehavior: "steer" } : {}),
      });
      await this.waitForAfter(
        (record) => record.type === "agent_settled",
        promptResponse.sequence,
        "remote task did not settle",
      );
      const { record: response } = await this.request({ type: "get_last_assistant_text" });
      const data = response.data;
      const text = data && typeof data === "object" && !Array.isArray(data)
        ? (data as JsonRecord).text
        : undefined;
      if (typeof text !== "string" || !text.trim()) {
        throw new Error("remote task returned no assistant response");
      }
      return text;
    } finally {
      unsubscribe();
    }
  }

  async abort(): Promise<void> {
    if (this.socket) await this.request({ type: "abort" });
  }

  async detach(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    this.taskId = undefined;
    this.buffer = "";
    if (socket) socket.destroy();
    const error = new Error("remote task session detached");
    this.failPending(error);
    this.notifyFailure(error);
  }

  private request(command: JsonRecord): Promise<SequencedRecord> {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      return Promise.reject(new Error("no remote task session is attached"));
    }
    const id = randomUUID();
    return new Promise<SequencedRecord>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("remote task request timed out"));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      socket.write(`${JSON.stringify({ ...command, id })}\n`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      });
    }).then((value) => {
      const { record } = value;
      if (record.success !== true) {
        throw new Error(typeof record.error === "string" ? record.error : "remote task request failed");
      }
      return value;
    });
  }

  private subscribe(listener: (record: JsonRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private waitFor(
    predicate: (record: JsonRecord) => boolean,
    timeoutMessage: string,
  ): Promise<JsonRecord> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(timeoutMessage));
      }, this.timeoutMs);
      const unsubscribe = this.subscribe((record) => {
        if (!predicate(record)) return;
        cleanup();
        resolve(record);
      });
      const fail = (error: Error) => {
        cleanup();
        reject(error);
      };
      this.failureListeners.add(fail);
      const cleanup = () => {
        clearTimeout(timer);
        unsubscribe();
        this.failureListeners.delete(fail);
      };
    });
  }

  private waitForAfter(
    predicate: (record: JsonRecord) => boolean,
    minimumSequence: number,
    timeoutMessage: string,
  ): Promise<JsonRecord> {
    if (
      this.lastSettled
      && this.lastSettled.sequence > minimumSequence
      && predicate(this.lastSettled.record)
    ) {
      return Promise.resolve(this.lastSettled.record);
    }
    return this.waitFor(predicate, timeoutMessage);
  }

  private consume(source: Socket, chunk: Buffer): void {
    if (source !== this.socket) return;
    this.buffer += chunk.toString("utf8");
    if (Buffer.byteLength(this.buffer) > MAX_RECORD_BYTES) {
        this.fail(new Error("remote task record is too large"), source);
      return;
    }
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const raw = this.buffer.slice(0, newline).replace(/\r$/u, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (!raw) continue;
      let record: unknown;
      try {
        record = JSON.parse(raw);
      } catch {
        this.fail(new Error("remote task returned invalid JSON"), source);
        return;
      }
      if (!record || typeof record !== "object" || Array.isArray(record)) continue;
      const value = record as JsonRecord;
      const sequence = ++this.sequence;
      if (value.type === "agent_settled") {
        this.lastSettled = { record: value, sequence };
      }
      if (value.type === "response" && typeof value.id === "string") {
        const pending = this.pending.get(value.id);
        if (pending) {
          this.pending.delete(value.id);
          pending.resolve({ record: value, sequence });
        }
      }
      for (const listener of [...this.listeners]) listener(value);
    }
  }

  private fail(error: Error, source: Socket): void {
    if (source !== this.socket) return;
    source.destroy();
    this.socket = undefined;
    this.taskId = undefined;
    this.failPending(error);
    this.notifyFailure(error);
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private notifyFailure(error: Error): void {
    for (const listener of [...this.failureListeners]) listener(error);
  }
}
