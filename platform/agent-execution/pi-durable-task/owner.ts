import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  createRegistry, defineDoc, defineExtension, defineTask, Harness,
  type TaskId,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { runPiSession } from "./session-execution.js";
import { closeTaskSessions } from "./remote-session.js";

/** A bounded operational task used to prove owner lifecycle before API cutover. */
export type ValidationInput = { text: string; holdMs: number };
type ValidationResult = { exit_code: 0; response: { text: string; spoken: string; presentation: null; resourceUri: null } };
export type ProductKind = "agent-run" | "song-lyrics" | "song-render" | "digital-twin-journal" | "digital-twin-classify";
export type ProductInput = { kind: ProductKind; params: Record<string, unknown>; requestId: string };
type ProductResult = Record<string, unknown>;

const Requests = defineDoc<{ entries: Record<string, { taskId: number; inputJson: string; createdAt?: string }> }>({
  kind: "voice.owner.requests",
  version: 1,
  scope: "session",
  initial: () => ({ entries: {} }),
  checkpointWhen: () => true,
});
const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

async function pythonEffect(module: string, input: Record<string, unknown>, signal: AbortSignal): Promise<ProductResult> {
  const workdir = process.env.PI_DURABLE_TASK_WORKDIR ?? process.cwd();
  const binary = process.env.PI_DURABLE_TASK_PYTHON ?? join(workdir, ".venv", "bin", "python");
  const args = ["-m", module];
  const child = spawn(binary, args, {
    cwd: workdir,
    env: { ...process.env, PI_DURABLE_OWNER_PID: String(process.pid) },
    signal, stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(JSON.stringify(input));
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-2000); });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (code !== 0) throw new Error(`product task exited ${code}: ${stderr}`);
  const result: unknown = JSON.parse(stdout);
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("invalid product result");
  return result as ProductResult;
}

async function executeProduct(input: ProductInput, signal: AbortSignal): Promise<ProductResult> {
  if (input.kind !== "agent-run" && input.kind !== "song-lyrics") {
    return pythonEffect("voice_worker.native_task", input, signal);
  }
  const prepared = await pythonEffect("voice_worker.workspace_effect", { ...input, action: "prepare" }, signal);
  if (typeof prepared.workspace !== "string" || typeof prepared.instruction !== "string") {
    throw new Error("workspace preparation returned an invalid Pi session input");
  }
  let progressQueue = Promise.resolve();
  let progressCount = 0;
  let lastSpoken = "";
  let lastAt = 0;
  const progress = (spoken: string) => {
    const now = Date.now();
    const bounded = spoken.trim().slice(0, 240);
    if (!bounded || progressCount >= 2_000 || (bounded === lastSpoken && now - lastAt < 8_000)) return;
    progressCount += 1;
    lastSpoken = bounded;
    lastAt = now;
    progressQueue = progressQueue.then(async () => {
      await pythonEffect("voice_worker.workspace_effect", {
        action: "progress", requestId: input.requestId, spoken: bounded,
      }, signal);
    }).catch(() => undefined);
  };
  progress("Preparing the task workspace.");
  const text = await runPiSession({
    taskId: input.requestId,
    workspace: prepared.workspace,
    instruction: prepared.instruction,
    imageRef: typeof prepared.imageRef === "string" ? prepared.imageRef : undefined,
    giteaRepository: typeof prepared.giteaRepository === "string" ? prepared.giteaRepository : undefined,
    onProgress: progress,
    signal,
  });
  await progressQueue;
  return pythonEffect("voice_worker.workspace_effect", {
    ...input, action: "finish", workspace: prepared.workspace, text,
  }, signal);
}

const ProductTask = defineTask<ProductInput, { phase: "run" | "external" }, ProductResult>({
  name: "voice.owner.product", version: 1,
  initial: () => ({ phase: "run" }),
  phases: {
    run: async (task, runtime, context) => {
      // A resumed non-idempotent effect needs inspection rather than a second invocation.
      if (task.input.kind === "song-render") {
        await runtime.commit(() => ({ status: "running", checkpoint: { phase: "external" } }), context);
      }
      const result = await executeProduct(task.input, runtime.signal);
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result } }), context);
    },
    external: async (_task, runtime, context) => {
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: {
        state: "needs_manual_reconciliation",
        message: "An external operation began previously without a recorded result; inspect before retrying.",
      } } }), context);
    },
  },
  abort: async (_task, runtime, context) => {
    await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context);
  },
});

const ValidationTask = defineTask<ValidationInput, { phase: "run" }, ValidationResult>({
  name: "voice.owner.validation",
  version: 1,
  initial: () => ({ phase: "run" }),
  phases: {
    run: async (task, runtime, context) => {
      if (task.input.holdMs > 0) {
        await new Promise<void>((resolve, reject) => {
          const done = () => {
            runtime.signal.removeEventListener("abort", stop);
            resolve();
          };
          const timer = setTimeout(done, task.input.holdMs);
          const stop = () => {
            clearTimeout(timer);
            runtime.signal.removeEventListener("abort", stop);
            reject(new Error("validation task interrupted"));
          };
          runtime.signal.addEventListener("abort", stop, { once: true });
          if (runtime.signal.aborted) stop();
        });
      }
      await runtime.commit(() => ({
        status: "terminal",
        outcome: { status: "completed", result: {
          exit_code: 0,
          response: {
            text: task.input.text,
            spoken: task.input.text,
            presentation: null,
            resourceUri: null,
          },
        } },
      }), context);
    },
  },
  abort: async (_task, runtime, context) => {
    await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context);
  },
});

export type OwnerSnapshot = {
  state: "pending" | "running" | "sleeping" | "completed" | "failed" | "cancelled";
  result: ValidationResult | ProductResult | null;
  failure: string | null;
};
type NativeSubmission = {
  task_id: string; identity: string; instruction: string; workspace: string; created_at: string;
};

export class DurableTaskOwner {
  private constructor(private readonly harness: Harness, private readonly root: Awaited<ReturnType<Harness["root"]>>) {}

  static async open(storagePath: string, restartLimit = 5): Promise<DurableTaskOwner> {
    const registry = createRegistry();
    registry.install(defineExtension({ name: "voice-owner-tasks", tasks: [ValidationTask, ProductTask] }));
    const harness = await Harness.open(
      await openNodeSqliteStorage(storagePath),
      { models: createModels(), registry, settings: { restartLimit } },
      BACKGROUND_CONTEXT,
    );
    try {
      const root = await harness.root(BACKGROUND_CONTEXT);
      harness.resume();
      return new DurableTaskOwner(harness, root);
    } catch (error) {
      await harness.close(BACKGROUND_CONTEXT);
      throw error;
    }
  }

  async submit(requestId: string, input: ValidationInput | ProductInput): Promise<string> {
    if (!TASK_ID.test(requestId)) throw new Error("task ID must be a lowercase UUID");
    await this.root.commit(async (tx) => {
      const requests = await tx.doc(Requests);
      const existing = requests.entries[requestId];
      if (existing) {
        if (existing.inputJson !== JSON.stringify(input)) {
          throw new Error("request ID was already used with different input");
        }
        return;
      }
      const taskId = await ("kind" in input
        ? tx.createTask(ProductTask, input, { ownership: { kind: "conversation" }, conversationId: this.root.id })
        : tx.createTask(ValidationTask, input, { ownership: { kind: "conversation" }, conversationId: this.root.id }));
      requests.entries[requestId] = { taskId, inputJson: JSON.stringify(input), createdAt: new Date().toISOString() };
    }, BACKGROUND_CONTEXT);
    return requestId;
  }

  private async nativeTaskId(taskId: string): Promise<TaskId<ValidationResult | ProductResult> | null> {
    const requests = await this.harness.snapshot(Requests, BACKGROUND_CONTEXT);
    return (requests?.entries[taskId]?.taskId ?? null) as TaskId<ValidationResult | ProductResult> | null;
  }

  async get(taskId: string): Promise<OwnerSnapshot | null> {
    const native = await this.nativeTaskId(taskId);
    if (native === null) return null;
    const task = await this.harness.getTask(native, BACKGROUND_CONTEXT);
    if (!task || ![ValidationTask.definition.name, ProductTask.definition.name].includes(task.kind)) return null;
    if (task.state.status !== "terminal") {
      return { state: task.state.status === "sleeping" ? "sleeping" :
        task.state.status === "running" ? "running" : "pending", result: null, failure: null };
    }
    const outcome = task.state.outcome;
    if (outcome.status === "completed") return { state: "completed", result: outcome.result, failure: null };
    if (outcome.status === "aborted") return { state: "cancelled", result: null, failure: null };
    return { state: "failed", result: null,
      failure: outcome.status === "failed" || outcome.status === "faulted"
        ? outcome.error.message : outcome.reason };
  }

  async getMany(taskIds: string[]): Promise<Record<string, OwnerSnapshot | null>> {
    const requests = await this.harness.snapshot(Requests, BACKGROUND_CONTEXT);
    return Object.fromEntries(await Promise.all(taskIds.map(async (taskId) => [
      taskId,
      requests?.entries[taskId]?.taskId ? await this.get(taskId) : null,
    ])));
  }

  private nativeSubmission(taskId: string, entry?: { inputJson: string; createdAt?: string }): NativeSubmission | null {
    if (!entry || typeof entry.inputJson !== "string") return null;
    let input: unknown;
    try { input = JSON.parse(entry.inputJson); } catch { return null; }
    if (!input || typeof input !== "object" || !("kind" in input) || input.kind !== "agent-run"
      || !("params" in input) || !input.params || typeof input.params !== "object") return null;
    const params = input.params as Record<string, unknown>;
    if (params.native_cli !== true || typeof params.identity !== "string"
      || typeof params.instruction !== "string" || typeof params.workspace !== "string") return null;
    return { task_id: taskId, identity: params.identity, instruction: params.instruction,
      workspace: params.workspace, created_at: entry.createdAt ?? new Date(0).toISOString() };
  }

  async describe(taskId: string): Promise<NativeSubmission | null> {
    const requests = await this.harness.snapshot(Requests, BACKGROUND_CONTEXT);
    return this.nativeSubmission(taskId, requests?.entries[taskId]);
  }

  async listNative(identity: string, limit = 50): Promise<Array<NativeSubmission & { result: OwnerSnapshot | null }>> {
    const requests = await this.harness.snapshot(Requests, BACKGROUND_CONTEXT);
    const entries = Object.entries(requests?.entries ?? {}).reverse();
    const matching = entries.flatMap(([id, entry]) => {
      const item = this.nativeSubmission(id, entry);
      return item?.identity === identity ? [item] : [];
    }).slice(0, limit);
    return Promise.all(matching.map(async (item) => ({ ...item, result: await this.get(item.task_id) })));
  }

  async abort(taskId: string): Promise<"marked" | "terminal"> {
    const native = await this.nativeTaskId(taskId);
    if (native === null) throw new Error("task not found");
    return this.harness.abortTask(native, BACKGROUND_CONTEXT);
  }

  async retry(taskId: string): Promise<void> {
    const native = await this.nativeTaskId(taskId);
    if (native === null) throw new Error("task not found");
    await this.harness.retryTask(native, BACKGROUND_CONTEXT);
  }

  async inspect(): Promise<Awaited<ReturnType<Harness["inspect"]>>> {
    return this.harness.inspect(BACKGROUND_CONTEXT);
  }

  async close(): Promise<void> {
    await closeTaskSessions();
    await this.harness.close(BACKGROUND_CONTEXT);
  }
}
