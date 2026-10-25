import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  AssistantEntry,
  createRegistry,
  Harness,
  watchEvents,
  type AgentEvent,
  type AgentEventStream,
  type Conversation,
  type EntryRecord,
  type EntryId,
  type Submission,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { connectMcpServer, createMcpToolExtension, type McpServerConfig, type McpToolClient } from "./mcp-tools.js";

export type ModelRef = { provider: string; modelId: string };
export type TaskSessionOptions = {
  storagePath: string;
  workspace: string;
  authPath?: string;
  skillsDirectory?: string;
  model?: ModelRef;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  models?: Models;
  env?: ExecutionEnv;
  mcpServers?: McpServerConfig[];
  mcpClients?: Array<{ config: McpServerConfig; client: McpToolClient }>;
  onEvent?: (event: AgentEvent) => void;
};

async function selectModel(models: Models, requested?: ModelRef): Promise<ModelRef> {
  if (requested) {
    if (!models.getModel(requested.provider, requested.modelId)) {
      throw new Error(`Pi Durable model is unavailable: ${requested.provider}/${requested.modelId}`);
    }
    return requested;
  }
  const available = await models.getAvailable();
  const preferred = available.find((candidate) =>
    candidate.provider === "openai-codex" && candidate.id === "gpt-6.1-sol"
  ) ?? available.find((candidate) => candidate.provider === "openai-codex") ?? available[0];
  if (!preferred) throw new Error("Pi Durable has no available model");
  return { provider: preferred.provider, modelId: preferred.id };
}

function assistantText(entry: EntryRecord | undefined): string {
  const model = entry?.model;
  if (!Array.isArray(model)) return "";
  const text: string[] = [];
  for (const message of model) {
    if (!message || typeof message !== "object" || !Array.isArray(message.content)) continue;
    for (const block of message.content as unknown[]) {
      if (block && typeof block === "object" && "type" in block
          && block.type === "text" && "text" in block && typeof block.text === "string") {
        text.push(block.text);
      }
    }
  }
  return text.join("").trim();
}

export class DurableTaskSession {
  private constructor(
    readonly harness: Harness,
    readonly conversation: Conversation,
    private readonly stream: AgentEventStream | undefined,
    private readonly mcpClients: McpToolClient[],
  ) {}

  static async open(options: TaskSessionOptions): Promise<DurableTaskSession> {
    const models = options.models ?? await ModelRuntime.create({
      authPath: options.authPath,
      allowModelNetwork: false,
    });
    const registry = createRegistry();
    registry.install(CodingTools);
    const clients: McpToolClient[] = [];
    try {
      for (const { config, client } of options.mcpClients ?? []) {
        registry.install(await createMcpToolExtension(config, client));
        clients.push(client);
      }
      for (const config of options.mcpServers ?? []) {
        const client = await connectMcpServer(config);
        clients.push(client);
        registry.install(await createMcpToolExtension(config, client));
      }
    } catch (error) {
      await Promise.all(clients.map((client) => client.close()));
      throw error;
    }
    let harness: Harness;
    try { harness = await Harness.open(
      await openNodeSqliteStorage(options.storagePath),
      {
        models,
        registry,
        env: ({ cwd }) => options.env ?? new NodeExecutionEnv({ cwd: cwd ?? options.workspace }),
      },
      BACKGROUND_CONTEXT,
    ); } catch (error) {
      await Promise.all(clients.map((client) => client.close()));
      throw error;
    }
    try {
      const conversation = await harness.root(BACKGROUND_CONTEXT, {
        agent: {
          model: await selectModel(models, options.model),
          thinkingLevel: options.thinkingLevel ?? "medium",
          cwd: options.workspace,
          instructions: options.skillsDirectory
            ? `Reusable task skills are installed under ${options.skillsDirectory}. `
              + "Find relevant SKILL.md files there, read their instructions before applying a skill, "
              + "and use the linked resources they reference."
            : undefined,
        },
      });
      const stream = options.onEvent
        ? await watchEvents(harness, conversation.id, BACKGROUND_CONTEXT)
        : undefined;
      stream?.start(async (events) => {
        for (const event of events) options.onEvent?.(event);
      });
      harness.resume();
      return new DurableTaskSession(harness, conversation, stream, clients);
    } catch (error) {
      await harness.close(BACKGROUND_CONTEXT);
      await Promise.all(clients.map((client) => client.close()));
      throw error;
    }
  }

  async submit(message: string, requestId: string, whenBusy: "steer" | "followUp" = "followUp") {
    const submission = await this.submitInput(message, requestId, whenBusy);
    return this.waitForAnswer(submission);
  }

  async submitInput(
    message: string,
    requestId: string,
    whenBusy: "steer" | "followUp" = "followUp",
  ): Promise<Submission> {
    return this.conversation.submit(
      { type: "input", content: message, requestId, whenBusy },
      BACKGROUND_CONTEXT,
    );
  }

  async waitForAnswer(submission: Submission) {
    const settled = await submission.wait(BACKGROUND_CONTEXT);
    if (settled.status !== "done" || settled.type !== "input") {
      throw new Error(`Pi Durable submission was not answered: ${settled.reason ?? settled.status}`);
    }
    const text = await this.answerText(settled.answer);
    if (!text) throw new Error("Pi Durable returned no assistant text");
    return { submissionId: submission.id, answerId: settled.answer, text };
  }

  async answerText(answerId: EntryId): Promise<string> {
    const answer = await this.conversation.commit(
      (tx) => tx.entry(AssistantEntry, answerId),
      BACKGROUND_CONTEXT,
    );
    return assistantText(answer);
  }

  async close(): Promise<void> {
    await this.stream?.stop();
    await this.harness.close(BACKGROUND_CONTEXT);
    await Promise.all(this.mcpClients.map((client) => client.close()));
  }
}
