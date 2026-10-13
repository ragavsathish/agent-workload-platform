import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chmod, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  calculateContextTokens,
  createAgentSession,
  createExtensionRuntime,
  DEFAULT_COMPACTION_SETTINGS,
  defineTool,
  getLastAssistantUsage,
  ModelRuntime,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { GondolinWorkspace } from "./gondolin-workspace.js";

type VoiceMessage = {
  role: "system" | "developer" | "user" | "assistant";
  content: string;
};

type ServiceSettings = {
  agentDir: string;
  cwd: string;
  gondolinAssets: string;
  gatewayToken: string;
  gatewayUrl: string;
  identity: string;
  listenHost: string;
  listenPort: number;
  model?: string;
  sessionDir: string;
  serviceToken: string;
  skillsDir: string;
  thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  timeoutMs: number;
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: { service: string; tool: string };
};

export type PublicTranscriptEntry = {
  id: string;
  timestamp: number;
  role: "user" | "assistant" | "tool";
  text: string;
  status?: "running" | "completed" | "failed";
};

export type PublicContextUsage = {
  tokens: number | null;
  contextWindow: number | null;
  percent: number | null;
  estimated: boolean;
  canCompact: boolean;
};

const MAX_TRANSCRIPT_ENTRIES = 200;
const MAX_TRANSCRIPT_TEXT_CHARS = 24_000;

export function canManuallyCompact(
  tokens: number | null,
  keepRecentTokens: number,
  compacting: boolean,
  lastEntryType: string | undefined,
): boolean {
  return tokens !== null
    && tokens > keepRecentTokens
    && !compacting
    && lastEntryType !== undefined
    && lastEntryType !== "compaction";
}

/** A bounded, display-safe projection of Pi events for the owner-only browser UI. */
export class PublicTranscript {
  private entries: PublicTranscriptEntry[] = [];
  private nextId = 1;
  private revision = 0;

  private append(
    entry: Omit<PublicTranscriptEntry, "id" | "timestamp">,
    requestedId?: string,
  ): string {
    const id = requestedId?.slice(0, 128) || String(this.nextId++);
    this.entries.push({
      ...entry,
      id,
      timestamp: Date.now(),
      text: entry.text.slice(0, MAX_TRANSCRIPT_TEXT_CHARS),
    });
    if (this.entries.length > MAX_TRANSCRIPT_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_TRANSCRIPT_ENTRIES);
    }
    this.revision += 1;
    return id;
  }

  addUser(text: string): void {
    this.append({ role: "user", text });
  }

  beginAssistant(): string {
    return this.append({ role: "assistant", text: "", status: "running" });
  }

  appendAssistantText(id: string, delta: string): void {
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (!entry || entry.role !== "assistant" || entry.status !== "running") return;
    entry.text = (entry.text + delta).slice(0, MAX_TRANSCRIPT_TEXT_CHARS);
    this.revision += 1;
  }

  finishAssistant(id: string): void {
    const index = this.entries.findIndex((candidate) => candidate.id === id);
    if (index < 0) return;
    if (!this.entries[index].text.trim()) {
      this.entries.splice(index, 1);
    } else {
      this.entries[index].status = "completed";
    }
    this.revision += 1;
  }

  startTool(toolCallId: string, toolName: string): void {
    const safeName = toolName.replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 80) || "tool";
    this.append({
      role: "tool",
      text: safeName,
      status: "running",
    }, toolCallId);
  }

  finishTool(toolCallId: string, failed: boolean): void {
    const entry = this.entries.find(
      (candidate) => candidate.role === "tool" && candidate.id === toolCallId.slice(0, 128),
    );
    if (!entry) return;
    entry.status = failed ? "failed" : "completed";
    this.revision += 1;
  }

  snapshot(): { revision: number; entries: PublicTranscriptEntry[] } {
    return {
      revision: this.revision,
      entries: this.entries.map((entry) => ({ ...entry })),
    };
  }
}

const MAX_BODY_BYTES = 131_072;
const proposalIdParameters = Type.Object(
  {
    proposal_id: Type.String({ description: "The exact proposal ID returned by propose_agent_task." }),
  },
  { additionalProperties: false },
);

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[name] = value;
  }
  return values;
}

export function normalizeMessages(input: unknown): VoiceMessage[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 64) {
    throw new Error("invalid message list");
  }
  let totalChars = 0;
  const messages = input.map((item): VoiceMessage => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("invalid message");
    }
    const role = (item as Record<string, unknown>).role;
    const rawContent = (item as Record<string, unknown>).content;
    if (!new Set(["system", "developer", "user", "assistant"]).has(String(role))) {
      throw new Error("invalid message role");
    }
    const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent ?? "");
    totalChars += content.length;
    return { role: role as VoiceMessage["role"], content };
  });
  if (totalChars > 64_000) throw new Error("conversation is too large");
  if (!messages.some((message) => message.role === "user" || message.role === "developer")) {
    throw new Error("conversation must contain a user or developer message");
  }
  return messages;
}

export function splitConversation(messages: VoiceMessage[]): {
  systemPrompt: string;
  transcript: VoiceMessage[];
} {
  return {
    systemPrompt: messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n"),
    transcript: messages
      .filter(
        (message) =>
          message.role === "developer"
          || message.role === "user"
          || message.role === "assistant",
      )
      .map((message) =>
        message.role === "developer" ? { role: "user", content: message.content } : message,
      ),
  };
}

export function latestConversationPrompt(transcript: VoiceMessage[]): string {
  const finalMessage = transcript.at(-1);
  if (!finalMessage || finalMessage.role !== "user") {
    throw new Error("conversation must end with a user message");
  }
  return finalMessage.content;
}

export function openVoiceSessionManager(cwd: string, sessionDir: string): SessionManager {
  return SessionManager.continueRecent(cwd, sessionDir);
}

function assistantText(session: AgentSession): string {
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index] as unknown as Record<string, unknown>;
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const text = message.content
      .filter(
        (part): part is { type: string; text: string } =>
          Boolean(part)
          && typeof part === "object"
          && (part as Record<string, unknown>).type === "text"
          && typeof (part as Record<string, unknown>).text === "string",
      )
      .map((part) => part.text)
      .join("")
      .trim();
    if (text) return text;
  }
  throw new Error("Pi completed without a spoken response");
}

function toolResult(payload: Record<string, unknown>, tool: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    details: { service: "agent-gateway", tool },
  };
}

function staticResourceLoader(systemPrompt: string) {
  const extensionsResult = {
    extensions: [],
    errors: [],
    runtime: createExtensionRuntime(),
  };
  return {
    getExtensions: () => extensionsResult,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: (_paths: unknown) => undefined,
    reload: async () => undefined,
  };
}

async function gatewayRequest(
  settings: ServiceSettings,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${settings.gatewayUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${settings.gatewayToken}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const payload: unknown = await response.json().catch(() => ({ detail: "invalid response" }));
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "detail" in payload
      ? String(payload.detail)
      : "request failed";
    throw new Error(`agent gateway rejected the request: ${detail}`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("agent gateway returned an invalid response");
  }
  return payload as Record<string, unknown>;
}

type TaskGatewayRequest = (
  method: "GET" | "POST",
  path: string,
  body?: Record<string, string>,
) => Promise<Record<string, unknown>>;

export async function submitAgentTask(
  request: TaskGatewayRequest,
  identity: string,
  instruction: string,
  workspace: string,
): Promise<Record<string, unknown>> {
  const proposal = await request("POST", "/tasks", { identity, instruction, workspace });
  if (typeof proposal.id !== "string" || proposal.id.length === 0) {
    throw new Error("agent gateway created a proposal without an ID");
  }
  return request(
    "POST",
    `/tasks/${encodeURIComponent(proposal.id)}/approve`,
    { identity },
  );
}

class VoiceAgent {
  private readonly gondolin: GondolinWorkspace;
  private readonly modelRuntime: ModelRuntime;
  private readonly settings: ServiceSettings;
  private createdThisTurn = new Set<string>();
  private session?: AgentSession;
  private systemPrompt = "";
  private readonly transcript = new PublicTranscript();
  private activeAssistantId?: string;
  private unsubscribeSession?: () => void;
  private turnQueue: Promise<void> = Promise.resolve();
  private activeDeltaSink?: (delta: string) => void;
  private estimatedContextTokens?: number;
  private compacting = false;
  private persistedContextTokens: number | null;
  private persistedContextWindow: number | null;

  private constructor(
    settings: ServiceSettings,
    modelRuntime: ModelRuntime,
    gondolin: GondolinWorkspace,
    persistedContextTokens: number | null,
    persistedContextWindow: number | null,
  ) {
    this.settings = settings;
    this.modelRuntime = modelRuntime;
    this.gondolin = gondolin;
    this.persistedContextTokens = persistedContextTokens;
    this.persistedContextWindow = persistedContextWindow;
  }

  static async create(settings: ServiceSettings): Promise<VoiceAgent> {
    const modelRuntime = await ModelRuntime.create({
      authPath: join(settings.agentDir, "auth.json"),
      modelsPath: join(settings.agentDir, "models.json"),
      modelsStorePath: join(settings.agentDir, "models-store.json"),
      allowModelNetwork: false,
    });
    const gondolin = await GondolinWorkspace.create({
      imagePath: settings.gondolinAssets,
      localCwd: settings.cwd,
      skillsDir: settings.skillsDir,
      sessionLabel: "pi-voice",
    });
    const persistedSession = openVoiceSessionManager(settings.cwd, settings.sessionDir);
    const entries = persistedSession.getEntries();
    const persistedUsage = getLastAssistantUsage(entries);
    const modelChange = [...entries].reverse().find((entry) => entry.type === "model_change");
    const persistedModel = modelChange?.type === "model_change"
      ? modelRuntime.getModel(modelChange.provider, modelChange.modelId)
      : undefined;
    return new VoiceAgent(
      settings,
      modelRuntime,
      gondolin,
      persistedUsage ? calculateContextTokens(persistedUsage) : null,
      persistedModel?.contextWindow ?? null,
    );
  }

  private tools() {
    return [
      ...this.gondolin.tools(),
      defineTool({
        name: "propose_agent_task",
        label: "Propose agent task",
        description: "Create a pending Pi task proposal. This does not start work.",
        promptSnippet: "Propose work without executing it.",
        parameters: Type.Object(
          {
            instruction: Type.String({ description: "Complete and specific instruction for Pi." }),
            workspace: Type.String({ description: "Allowlisted logical workspace name." }),
          },
          { additionalProperties: false },
        ),
        execute: async (_toolCallId, params) => {
          const payload = await gatewayRequest(this.settings, "POST", "/tasks", {
            identity: this.settings.identity,
            instruction: params.instruction,
            workspace: params.workspace,
          });
          if (typeof payload.id === "string") this.createdThisTurn.add(payload.id);
          return toolResult(payload, "propose_agent_task");
        },
      }),
      defineTool({
        name: "submit_agent_task",
        label: "Submit agent task",
        description:
          "Create and immediately approve durable project work for another Pi worker to pick up. No later approval is required.",
        promptSnippet: "Submit durable asynchronous work directly to another Pi worker.",
        parameters: Type.Object(
          {
            instruction: Type.String({ description: "Complete and specific instruction for Pi." }),
            workspace: Type.String({ description: "Allowlisted logical workspace name." }),
          },
          { additionalProperties: false },
        ),
        execute: async (_toolCallId, params) => {
          const payload = await submitAgentTask(
            (method, path, body) => gatewayRequest(this.settings, method, path, body),
            this.settings.identity,
            params.instruction,
            params.workspace,
          );
          return toolResult(payload, "submit_agent_task");
        },
      }),
      defineTool({
        name: "get_agent_task",
        label: "Get agent task",
        description: "Read the status and bounded result of one owned Pi task proposal.",
        parameters: proposalIdParameters,
        execute: async (_toolCallId, params) => {
          const proposalId = encodeURIComponent(params.proposal_id);
          const payload = await gatewayRequest(
            this.settings,
            "GET",
            `/tasks/${proposalId}?identity=${encodeURIComponent(this.settings.identity)}`,
          );
          return toolResult(payload, "get_agent_task");
        },
      }),
      defineTool({
        name: "approve_agent_task",
        label: "Approve agent task",
        description: "Approve a pending proposal after explicit approval in a later user turn.",
        parameters: proposalIdParameters,
        execute: async (_toolCallId, params) => {
          if (this.createdThisTurn.has(params.proposal_id)) {
            throw new Error("a proposal cannot be approved in the same user turn that created it");
          }
          const proposalId = encodeURIComponent(params.proposal_id);
          const payload = await gatewayRequest(
            this.settings,
            "POST",
            `/tasks/${proposalId}/approve`,
            { identity: this.settings.identity },
          );
          return toolResult(payload, "approve_agent_task");
        },
      }),
      defineTool({
        name: "cancel_agent_task",
        label: "Cancel agent task",
        description: "Cancel one pending or running task owned by the authenticated identity.",
        parameters: proposalIdParameters,
        execute: async (_toolCallId, params) => {
          const proposalId = encodeURIComponent(params.proposal_id);
          const payload = await gatewayRequest(
            this.settings,
            "POST",
            `/tasks/${proposalId}/cancel`,
            { identity: this.settings.identity },
          );
          return toolResult(payload, "cancel_agent_task");
        },
      }),
    ];
  }

  private async newSession(systemPrompt: string): Promise<void> {
    this.unsubscribeSession?.();
    this.unsubscribeSession = undefined;
    this.session?.dispose();
    const resourceLoader = staticResourceLoader(systemPrompt);
    let model;
    if (this.settings.model) {
      const separator = this.settings.model.indexOf("/");
      if (separator < 1 || separator === this.settings.model.length - 1) {
        throw new Error("PI_VOICE_MODEL must use provider/model format");
      }
      model = this.modelRuntime.getModel(
        this.settings.model.slice(0, separator),
        this.settings.model.slice(separator + 1),
      );
      if (!model) throw new Error(`Pi voice model is unavailable: ${this.settings.model}`);
    }
    const { session } = await createAgentSession({
      cwd: this.settings.cwd,
      agentDir: this.settings.agentDir,
      modelRuntime: this.modelRuntime,
      model,
      thinkingLevel: this.settings.thinking,
      tools: [
        "read",
        "write",
        "edit",
        "bash",
        "propose_agent_task",
        "submit_agent_task",
        "get_agent_task",
        "approve_agent_task",
        "cancel_agent_task",
      ],
      customTools: this.tools(),
      resourceLoader,
      sessionManager: openVoiceSessionManager(this.settings.cwd, this.settings.sessionDir),
    });
    this.session = session;
    this.unsubscribeSession = session.subscribe((event) => {
      if (event.type === "message_start" && event.message.role === "assistant") {
        this.activeAssistantId = this.transcript.beginAssistant();
      } else if (
        event.type === "message_update"
        && event.assistantMessageEvent.type === "text_delta"
      ) {
        this.activeAssistantId ??= this.transcript.beginAssistant();
        this.transcript.appendAssistantText(
          this.activeAssistantId,
          event.assistantMessageEvent.delta,
        );
        this.activeDeltaSink?.(event.assistantMessageEvent.delta);
      } else if (event.type === "message_end" && event.message.role === "assistant") {
        if (this.activeAssistantId) this.transcript.finishAssistant(this.activeAssistantId);
        this.activeAssistantId = undefined;
        this.estimatedContextTokens = undefined;
        const usage = this.session?.getContextUsage();
        if (usage?.tokens !== null && usage?.tokens !== undefined) {
          this.persistedContextTokens = usage.tokens;
          this.persistedContextWindow = usage.contextWindow;
        }
      } else if (event.type === "tool_execution_start") {
        this.transcript.startTool(event.toolCallId, event.toolName);
      } else if (event.type === "tool_execution_end") {
        this.transcript.finishTool(event.toolCallId, event.isError);
      }
    });
    this.systemPrompt = systemPrompt;
  }

  transcriptSnapshot(): { revision: number; entries: PublicTranscriptEntry[] } {
    return this.transcript.snapshot();
  }

  contextSnapshot(): PublicContextUsage {
    const usage = this.session?.getContextUsage();
    const tokens = usage?.tokens
      ?? this.estimatedContextTokens
      ?? this.persistedContextTokens;
    const contextWindow = usage?.contextWindow
      ?? this.session?.model?.contextWindow
      ?? this.persistedContextWindow;
    const percent = tokens !== null && contextWindow
      ? Math.min(100, (tokens / contextWindow) * 100)
      : null;
    const sessionManager = this.session?.sessionManager
      ?? openVoiceSessionManager(this.settings.cwd, this.settings.sessionDir);
    const branch = sessionManager.getBranch();
    const keepRecentTokens = this.session?.settingsManager.getCompactionKeepRecentTokens()
      ?? DEFAULT_COMPACTION_SETTINGS.keepRecentTokens;
    return {
      tokens,
      contextWindow,
      percent,
      estimated: usage?.tokens == null && this.estimatedContextTokens !== undefined,
      canCompact: canManuallyCompact(
        tokens,
        keepRecentTokens,
        this.compacting,
        branch.at(-1)?.type,
      ),
    };
  }

  async compact(): Promise<PublicContextUsage> {
    const execute = async (): Promise<PublicContextUsage> => {
      if (!this.session) await this.newSession(this.systemPrompt);
      if (!this.session) throw new Error("Pi voice session is unavailable");
      this.compacting = true;
      try {
        const result = await this.session.compact();
        this.estimatedContextTokens = result.estimatedTokensAfter;
        this.persistedContextTokens = result.estimatedTokensAfter ?? null;
        this.persistedContextWindow = this.session.model?.contextWindow ?? null;
        return this.contextSnapshot();
      } finally {
        this.compacting = false;
      }
    };

    const result = this.turnQueue.then(execute, execute);
    this.turnQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async runTurn(rawMessages: unknown, onDelta?: (delta: string) => void): Promise<string> {
    const execute = async (): Promise<string> => {
      const messages = normalizeMessages(rawMessages);
      const { systemPrompt, transcript } = splitConversation(messages);
      if (this.session === undefined || this.systemPrompt !== systemPrompt) {
        await this.newSession(systemPrompt);
      }
      if (!this.session) throw new Error("Pi voice session is unavailable");

      this.createdThisTurn = new Set<string>();
      const prompt = latestConversationPrompt(transcript);
      this.transcript.addUser(prompt);
      this.activeDeltaSink = onDelta;

      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        void this.session?.abort();
      }, this.settings.timeoutMs);
      try {
        await this.session.prompt(prompt, { expandPromptTemplates: false, source: "rpc" });
        await this.session.waitForIdle();
      } finally {
        clearTimeout(timeout);
        this.activeDeltaSink = undefined;
      }
      if (timedOut) throw new Error("Pi voice turn timed out");
      return assistantText(this.session);
    };

    const result = this.turnQueue.then(execute, execute);
    this.turnQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async turn(rawMessages: unknown): Promise<string> {
    return this.runTurn(rawMessages);
  }

  async streamTurn(rawMessages: unknown, onDelta: (delta: string) => void): Promise<string> {
    return this.runTurn(rawMessages, onDelta);
  }

  async abort(): Promise<void> {
    await this.session?.abort();
  }

  async close(): Promise<void> {
    this.unsubscribeSession?.();
    this.unsubscribeSession = undefined;
    const session = this.session;
    this.session = undefined;
    if (session) {
      await session.abort().catch(() => undefined);
      session.dispose();
    }
    await this.gondolin.close();
  }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body is too large");
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, status: number, payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function loadSettings(): Promise<ServiceSettings> {
  const envFile = process.env.PI_VOICE_ENV_FILE;
  if (envFile) {
    const values = parseEnvFile(await readFile(envFile, "utf8"));
    for (const [name, value] of Object.entries(values)) process.env[name] ??= value;
  }
  const identities = requiredEnv("ORCHESTRATOR_ALLOWED_USERS")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (identities.length !== 1) throw new Error("Pi voice requires exactly one allowed identity");
  const thinking = (process.env.PI_VOICE_THINKING?.trim() || "low") as ServiceSettings["thinking"];
  if (!new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]).has(thinking)) {
    throw new Error("invalid PI_VOICE_THINKING");
  }
  const agentDir = resolve(process.env.PI_CODING_AGENT_DIR || join(process.env.HOME || "", ".pi/agent"));
  const sessionDir = resolve(
    process.env.PI_VOICE_SESSION_DIR || join(agentDir, "voice-sessions"),
  );
  const cwd = resolve(process.env.PI_VOICE_CWD || process.cwd());
  const skillsDir = resolve(process.env.PI_VOICE_SKILLS_DIR || join(cwd, "..", "skills"));
  await mkdir(sessionDir, { recursive: true, mode: 0o700 });
  await chmod(sessionDir, 0o700);
  return {
    agentDir,
    cwd,
    gondolinAssets: resolve(requiredEnv("GONDOLIN_BROWSER_ASSETS")),
    gatewayToken: requiredEnv("AGENT_GATEWAY_TOKEN"),
    gatewayUrl: (process.env.AGENT_GATEWAY_BASE_URL || "http://127.0.0.1:9444/v1").replace(/\/$/, ""),
    identity: identities[0],
    listenHost: process.env.PI_VOICE_SERVICE_HOST || "127.0.0.1",
    listenPort: Number.parseInt(process.env.PI_VOICE_SERVICE_PORT || "9446", 10),
    model: process.env.PI_VOICE_MODEL?.trim() || process.env.PI_MODEL?.trim() || undefined,
    sessionDir,
    serviceToken: requiredEnv("INFERENCE_BROKER_TOKEN"),
    skillsDir,
    thinking,
    timeoutMs: Number.parseFloat(process.env.PI_VOICE_TIMEOUT_SECONDS || "120") * 1000,
  };
}

export async function main(): Promise<void> {
  const settings = await loadSettings();
  const agent = await VoiceAgent.create(settings);
  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${settings.serviceToken}`) {
      sendJson(response, 401, { detail: "invalid Pi voice credential" });
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }
    if (request.method === "GET" && request.url === "/v1/transcript") {
      response.setHeader("cache-control", "no-store");
      sendJson(response, 200, agent.transcriptSnapshot());
      return;
    }
    if (request.method === "GET" && request.url === "/v1/context") {
      response.setHeader("cache-control", "no-store");
      sendJson(response, 200, agent.contextSnapshot());
      return;
    }
    if (request.method === "POST" && request.url === "/v1/context/compact") {
      try {
        response.setHeader("cache-control", "no-store");
        sendJson(response, 200, await agent.compact());
      } catch (error) {
        sendJson(response, 409, {
          detail: error instanceof Error ? error.message : "Pi context compaction failed",
        });
      }
      return;
    }
    if (request.method !== "POST" || !["/v1/turn", "/v1/turn/stream"].includes(request.url || "")) {
      sendJson(response, 404, { detail: "not found" });
      return;
    }
    try {
      const body = await readBody(request);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid request");
      const messages = (body as Record<string, unknown>).messages;
      if (request.url === "/v1/turn/stream") {
        response.writeHead(200, {
          "cache-control": "no-cache, no-transform",
          "connection": "keep-alive",
          "content-type": "text/event-stream; charset=utf-8",
          "x-accel-buffering": "no",
        });
        const send = (event: Record<string, unknown>) => {
          response.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        const abortOnDisconnect = () => {
          if (!response.writableEnded) void agent.abort();
        };
        request.once("close", abortOnDisconnect);
        try {
          await agent.streamTurn(messages, (delta) => send({ type: "delta", delta }));
          send({ type: "done" });
          response.end();
        } catch (error) {
          send({
            type: "error",
            detail: error instanceof Error ? error.message : "Pi voice turn failed",
          });
          response.end();
        } finally {
          request.off("close", abortOnDisconnect);
        }
      } else {
        const text = await agent.turn(messages);
        sendJson(response, 200, { text });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Pi voice turn failed";
      if (!response.headersSent) sendJson(response, 502, { detail });
      else response.end();
    }
  });
  server.listen(settings.listenPort, settings.listenHost);

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await agent.close();
    await new Promise<void>((resolveShutdown, rejectShutdown) => {
      server.close((error) => error ? rejectShutdown(error) : resolveShutdown());
    });
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
