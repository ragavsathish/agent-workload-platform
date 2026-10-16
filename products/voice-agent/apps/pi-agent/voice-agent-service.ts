import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chmod, mkdir, readFile } from "node:fs/promises";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  calculateContextTokens,
  createAgentSession,
  createMcpExtension,
  createToolSearchExtension,
  DEFAULT_COMPACTION_SETTINGS,
  DefaultResourceLoader,
  defineTool,
  getLastAssistantUsage,
  ModelRuntime,
  SessionManager,
  type AgentSession,
  type ExtensionAPI,
  type ExtensionFactory,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { GondolinWorkspace, GUEST_SKILLS } from "./gondolin-workspace.js";

type VoiceMessage = {
  role: "system" | "developer" | "user" | "assistant";
  content: string;
};

type ServiceSettings = {
  agentDir: string;
  cwd: string;
  giteaEndpointUrl: string;
  giteaOwner: string;
  giteaToken: string;
  gondolinAssets: string;
  gatewayToken: string;
  gatewayUrl: string;
  identity: string;
  listenHost: string;
  listenPort: number;
  model?: string;
  prometheusEndpointUrl: string;
  sessionDir: string;
  serviceToken: string;
  skillsDir: string;
  s3MockAccessKey: string;
  s3MockBucket: string;
  s3MockEndpointUrl: string;
  s3MockSecretKey: string;
  thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  timeoutMs: number;
  wassetteBin: string;
  wassetteComponentDir: string;
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

export type PublicSessionSummary = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  active: boolean;
};

const MAX_TRANSCRIPT_ENTRIES = 200;
const MAX_TRANSCRIPT_TEXT_CHARS = 24_000;
const WASSETTE_SYSTEM_PROMPT = `Wassette provides capability-controlled WebAssembly tools through MCP.
Use tool_search when a request could benefit from a Wassette component. Components start without
host capabilities: grant only the minimum capability needed for the current request, and never grant
access to orchestrator credentials, the Pi agent directory, or unrelated host files.`;

const SCRUBBED_WASSETTE_ENV = {
  AGENT_GATEWAY_TOKEN: "",
  ARTIFACT_ACCESS_KEY: "",
  ARTIFACT_SECRET_KEY: "",
  AWS_ACCESS_KEY_ID: "",
  AWS_SECRET_ACCESS_KEY: "",
  AWS_SESSION_TOKEN: "",
  DATABASE_URL: "",
  GITEA_BUILDER_TOKEN: "",
  GITEA_TOKEN: "",
  GITHUB_TOKEN: "",
  INFERENCE_BROKER_TOKEN: "",
  ORCHESTRATOR_APPROVAL_SECRET: "",
};

export function createWassetteMcpRegistration(
  settings: Pick<ServiceSettings, "cwd" | "wassetteBin" | "wassetteComponentDir">,
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.registerMcpServer("wassette", {
      command: settings.wassetteBin,
      args: ["run", "--component-dir", settings.wassetteComponentDir],
      cwd: settings.cwd,
      env: { ...SCRUBBED_WASSETTE_ENV },
      exposure: "deferred",
      description: "Run capability-controlled WebAssembly components with Wassette.",
      timeout: 60,
    });
  };
}

/** Voice MCP is explicit: shared user or project mcp.json files must not override its policy. */
export function isolatedVoiceMcpConfig() {
  return { servers: [], errors: [] };
}

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

  reset(): void {
    this.entries = [];
    this.revision += 1;
  }

  replace(entries: PublicTranscriptEntry[]): void {
    this.entries = entries.slice(-MAX_TRANSCRIPT_ENTRIES).map((entry) => ({ ...entry }));
    this.revision += 1;
  }
}

function publicMessageText(content: unknown): string {
  if (typeof content === "string") return content.slice(0, MAX_TRANSCRIPT_TEXT_CHARS);
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) return [];
      const value = part as Record<string, unknown>;
      return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
    })
    .join("")
    .slice(0, MAX_TRANSCRIPT_TEXT_CHARS);
}

/** Project a persisted Pi branch without exposing reasoning, tool input, or tool output. */
export function publicSessionTranscript(entries: SessionEntry[]): PublicTranscriptEntry[] {
  const results = new Map<string, boolean>();
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "toolResult") continue;
    results.set(entry.message.toolCallId, entry.message.isError);
  }
  const projected: PublicTranscriptEntry[] = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    const timestamp = Number.isFinite(message.timestamp)
      ? message.timestamp
      : Date.parse(entry.timestamp);
    if (message.role === "user") {
      const text = publicMessageText(message.content);
      if (text) projected.push({ id: entry.id, timestamp, role: "user", text });
      continue;
    }
    if (message.role !== "assistant") continue;
    const text = publicMessageText(message.content);
    if (text) {
      projected.push({
        id: entry.id,
        timestamp,
        role: "assistant",
        text,
        status: "completed",
      });
    }
    for (const part of message.content) {
      if (part.type !== "toolCall") continue;
      const safeName = part.name.replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 80) || "tool";
      const failed = results.get(part.id);
      projected.push({
        id: part.id.slice(0, 128),
        timestamp,
        role: "tool",
        text: safeName,
        status: failed === undefined ? "running" : failed ? "failed" : "completed",
      });
    }
  }
  return projected.slice(-MAX_TRANSCRIPT_ENTRIES);
}

/** Restore the display-safe transcript for the persisted active Voice Session. */
export function restorePublicTranscript(sessionManager: SessionManager): PublicTranscript {
  const transcript = new PublicTranscript();
  transcript.replace(publicSessionTranscript(sessionManager.getBranch()));
  return transcript;
}

function sessionTitle(name: string | undefined, firstMessage: string): string {
  const value = (name?.trim() || firstMessage.trim() || "Untitled session")
    .replace(/\s+/g, " ");
  return value.length > 72 ? `${value.slice(0, 69)}…` : value;
}

export async function listVoiceSessions(
  cwd: string,
  sessionDir: string,
  activeId: string,
): Promise<PublicSessionSummary[]> {
  const sessions = await SessionManager.list(cwd, sessionDir);
  const catalog = sessions.slice(0, 30).map((session) => ({
    id: session.id,
    title: sessionTitle(session.name, session.firstMessage),
    updatedAt: session.modified.toISOString(),
    messageCount: session.messageCount,
    active: session.id === activeId,
  }));
  if (!catalog.some((session) => session.active)) {
    catalog.unshift({
      id: activeId,
      title: "Voice orchestrator",
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      active: true,
    });
  }
  return catalog.slice(0, 30).sort(
    (left, right) => Number(right.active) - Number(left.active),
  );
}

export function readVoiceSession(
  cwd: string,
  sessionDir: string,
  sessionId: string,
): { revision: number; entries: PublicTranscriptEntry[] } | undefined {
  const path = SessionManager.findById(cwd, sessionId, sessionDir);
  if (!path) return undefined;
  const manager = SessionManager.open(path, sessionDir, cwd);
  const branch = manager.getBranch();
  return { revision: branch.length, entries: publicSessionTranscript(branch) };
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

function guestSkillPath(skillsDir: string, hostPath: string): string {
  const relativePath = relative(skillsDir, hostPath);
  if (
    relativePath === ".."
    || relativePath.startsWith(`..${sep}`)
    || isAbsolute(relativePath)
  ) {
    throw new Error(`Pi discovered a skill outside the configured skills directory: ${hostPath}`);
  }
  return posix.join(GUEST_SKILLS, ...relativePath.split(sep));
}

export async function skillResourceLoader(
  systemPrompt: string,
  settings: Pick<ServiceSettings, "agentDir" | "cwd" | "skillsDir">,
  extensionFactories: ExtensionFactory[] = [],
): Promise<DefaultResourceLoader> {
  const loader = new DefaultResourceLoader({
    cwd: settings.cwd,
    agentDir: settings.agentDir,
    systemPrompt,
    appendSystemPrompt: extensionFactories.length > 0 ? [WASSETTE_SYSTEM_PROMPT] : [],
    extensionFactories,
    additionalSkillPaths: [settings.skillsDir],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    skillsOverride: ({ skills, diagnostics }) => ({
      diagnostics,
      skills: skills.map((skill) => ({
        ...skill,
        filePath: guestSkillPath(settings.skillsDir, skill.filePath),
        baseDir: guestSkillPath(settings.skillsDir, skill.baseDir),
        sourceInfo: {
          ...skill.sourceInfo,
          path: guestSkillPath(settings.skillsDir, skill.sourceInfo.path),
          ...(skill.sourceInfo.baseDir
            ? { baseDir: guestSkillPath(settings.skillsDir, skill.sourceInfo.baseDir) }
            : {}),
        },
      })),
    }),
  });
  await loader.reload();
  return loader;
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
  private readonly transcript: PublicTranscript;
  private activeAssistantId?: string;
  private unsubscribeSession?: () => void;
  private turnQueue: Promise<void> = Promise.resolve();
  private activeDeltaSink?: (delta: string) => void;
  private estimatedContextTokens?: number;
  private compacting = false;
  private persistedContextTokens: number | null;
  private persistedContextWindow: number | null;
  private activeSessionId: string;
  private pendingSessionManager?: SessionManager;
  private turnsInFlight = 0;
  private maintenanceInFlight = 0;

  private constructor(
    settings: ServiceSettings,
    modelRuntime: ModelRuntime,
    gondolin: GondolinWorkspace,
    persistedContextTokens: number | null,
    persistedContextWindow: number | null,
    activeSessionId: string,
    transcript: PublicTranscript,
  ) {
    this.settings = settings;
    this.modelRuntime = modelRuntime;
    this.gondolin = gondolin;
    this.persistedContextTokens = persistedContextTokens;
    this.persistedContextWindow = persistedContextWindow;
    this.activeSessionId = activeSessionId;
    this.transcript = transcript;
  }

  static async create(settings: ServiceSettings): Promise<VoiceAgent> {
    const modelRuntime = await ModelRuntime.create({
      authPath: join(settings.agentDir, "auth.json"),
      modelsPath: join(settings.agentDir, "models.json"),
      modelsStorePath: join(settings.agentDir, "models-store.json"),
      allowModelNetwork: false,
    });
    const gondolin = await GondolinWorkspace.create({
      giteaEndpointUrl: settings.giteaEndpointUrl,
      giteaOwner: settings.giteaOwner,
      giteaToken: settings.giteaToken,
      imagePath: settings.gondolinAssets,
      localCwd: settings.cwd,
      prometheusEndpointUrl: settings.prometheusEndpointUrl,
      skillsDir: settings.skillsDir,
      s3MockAccessKey: settings.s3MockAccessKey,
      s3MockBucket: settings.s3MockBucket,
      s3MockEndpointUrl: settings.s3MockEndpointUrl,
      s3MockSecretKey: settings.s3MockSecretKey,
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
      persistedSession.getSessionId(),
      restorePublicTranscript(persistedSession),
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
    const resourceLoader = await skillResourceLoader(systemPrompt, this.settings, [
      createToolSearchExtension(),
      createMcpExtension({ loadConfig: isolatedVoiceMcpConfig }),
      createWassetteMcpRegistration(this.settings),
    ]);
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
    const sessionManager = this.pendingSessionManager
      ?? openVoiceSessionManager(this.settings.cwd, this.settings.sessionDir);
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
        "tool_search",
        "propose_agent_task",
        "submit_agent_task",
        "get_agent_task",
        "approve_agent_task",
        "cancel_agent_task",
      ],
      customTools: this.tools(),
      resourceLoader,
      sessionManager,
    });
    this.session = session;
    this.pendingSessionManager = undefined;
    this.activeSessionId = session.sessionManager.getSessionId();
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
    await session.bindExtensions({});
    this.systemPrompt = systemPrompt;
  }

  transcriptSnapshot(): { revision: number; entries: PublicTranscriptEntry[] } {
    return this.transcript.snapshot();
  }

  async sessionCatalog(): Promise<{ sessions: PublicSessionSummary[] }> {
    return {
      sessions: await listVoiceSessions(
        this.settings.cwd,
        this.settings.sessionDir,
        this.activeSessionId,
      ),
    };
  }

  historicalSession(sessionId: string): { revision: number; entries: PublicTranscriptEntry[] } | undefined {
    return readVoiceSession(this.settings.cwd, this.settings.sessionDir, sessionId);
  }

  startFreshSession(): { id: string } {
    if (this.turnsInFlight > 0 || this.maintenanceInFlight > 0) {
      throw new Error("Pi is busy; stop or finish the active turn before starting a new session");
    }
    this.unsubscribeSession?.();
    this.unsubscribeSession = undefined;
    this.session?.dispose();
    this.session = undefined;
    this.pendingSessionManager = SessionManager.create(
      this.settings.cwd,
      this.settings.sessionDir,
    );
    this.activeSessionId = this.pendingSessionManager.getSessionId();
    this.systemPrompt = "";
    this.persistedContextTokens = null;
    this.persistedContextWindow = null;
    this.estimatedContextTokens = undefined;
    this.transcript.reset();
    return { id: this.activeSessionId };
  }

  resumeSession(sessionId: string): { id: string } | undefined {
    if (this.turnsInFlight > 0 || this.maintenanceInFlight > 0) {
      throw new Error("Pi is busy; stop or finish the active turn before resuming a session");
    }
    const path = SessionManager.findById(
      this.settings.cwd,
      sessionId,
      this.settings.sessionDir,
    );
    if (!path) return undefined;
    const manager = SessionManager.open(
      path,
      this.settings.sessionDir,
      this.settings.cwd,
    );
    const entries = manager.getEntries();
    const usage = getLastAssistantUsage(entries);
    const modelChange = [...entries].reverse().find(
      (entry) => entry.type === "model_change",
    );
    const model = modelChange?.type === "model_change"
      ? this.modelRuntime.getModel(modelChange.provider, modelChange.modelId)
      : undefined;
    this.unsubscribeSession?.();
    this.unsubscribeSession = undefined;
    this.session?.dispose();
    this.session = undefined;
    this.pendingSessionManager = manager;
    this.activeSessionId = manager.getSessionId();
    this.systemPrompt = "";
    this.persistedContextTokens = usage ? calculateContextTokens(usage) : null;
    this.persistedContextWindow = model?.contextWindow ?? null;
    this.estimatedContextTokens = undefined;
    this.transcript.replace(publicSessionTranscript(manager.getBranch()));
    return { id: this.activeSessionId };
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
      ?? this.pendingSessionManager
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
    this.maintenanceInFlight += 1;
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
    try {
      return await result;
    } finally {
      this.maintenanceInFlight -= 1;
    }
  }

  private async runTurn(rawMessages: unknown, onDelta?: (delta: string) => void): Promise<string> {
    this.turnsInFlight += 1;
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
    try {
      return await result;
    } finally {
      this.turnsInFlight -= 1;
    }
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
    giteaEndpointUrl: requiredEnv("GITEA_ENDPOINT_URL"),
    giteaOwner: requiredEnv("GITEA_OWNER"),
    giteaToken: requiredEnv("GITEA_TOKEN"),
    gondolinAssets: resolve(requiredEnv("GONDOLIN_BROWSER_ASSETS")),
    gatewayToken: requiredEnv("AGENT_GATEWAY_TOKEN"),
    gatewayUrl: (process.env.AGENT_GATEWAY_BASE_URL || "http://127.0.0.1:9444/v1").replace(/\/$/, ""),
    identity: identities[0],
    listenHost: process.env.PI_VOICE_SERVICE_HOST || "127.0.0.1",
    listenPort: Number.parseInt(process.env.PI_VOICE_SERVICE_PORT || "9446", 10),
    model: process.env.PI_VOICE_MODEL?.trim() || process.env.PI_MODEL?.trim() || undefined,
    prometheusEndpointUrl: process.env.PROMETHEUS_ENDPOINT_URL || "http://127.0.0.1:9091",
    sessionDir,
    serviceToken: requiredEnv("INFERENCE_BROKER_TOKEN"),
    skillsDir,
    s3MockAccessKey: requiredEnv("ARTIFACT_ACCESS_KEY"),
    s3MockBucket: requiredEnv("ARTIFACT_BUCKET"),
    s3MockEndpointUrl: requiredEnv("ARTIFACT_ENDPOINT_URL"),
    s3MockSecretKey: requiredEnv("ARTIFACT_SECRET_KEY"),
    thinking,
    timeoutMs: Number.parseFloat(process.env.PI_VOICE_TIMEOUT_SECONDS || "120") * 1000,
    wassetteBin: resolve(requiredEnv("WASSETTE_BIN")),
    wassetteComponentDir: resolve(requiredEnv("WASSETTE_COMPONENT_DIR")),
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
    if (request.method === "GET" && request.url === "/v1/sessions") {
      response.setHeader("cache-control", "no-store");
      sendJson(response, 200, await agent.sessionCatalog());
      return;
    }
    if (request.method === "POST" && request.url === "/v1/sessions/new") {
      try {
        const fresh = agent.startFreshSession();
        response.setHeader("cache-control", "no-store");
        sendJson(response, 201, fresh);
      } catch (error) {
        sendJson(response, 409, {
          detail: error instanceof Error ? error.message : "Pi session could not be started",
        });
      }
      return;
    }
    const resumeSession = request.url?.match(
      /^\/v1\/sessions\/([A-Za-z0-9_-]{1,128})\/resume$/,
    );
    if (request.method === "POST" && resumeSession) {
      try {
        const resumed = agent.resumeSession(resumeSession[1]);
        if (!resumed) sendJson(response, 404, { detail: "session not found" });
        else {
          response.setHeader("cache-control", "no-store");
          sendJson(response, 200, resumed);
        }
      } catch (error) {
        sendJson(response, 409, {
          detail: error instanceof Error ? error.message : "Pi session could not be resumed",
        });
      }
      return;
    }
    const historicalSession = request.url?.match(/^\/v1\/sessions\/([A-Za-z0-9_-]{1,128})$/);
    if (request.method === "GET" && historicalSession) {
      response.setHeader("cache-control", "no-store");
      const snapshot = agent.historicalSession(historicalSession[1]);
      if (!snapshot) sendJson(response, 404, { detail: "session not found" });
      else sendJson(response, 200, snapshot);
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
    if (request.method === "POST" && request.url === "/v1/turn/abort") {
      await agent.abort();
      sendJson(response, 200, { status: "stopped" });
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
