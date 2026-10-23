import { join } from "node:path";

import {
  calculateContextTokens,
  createAgentSession,
  createMcpExtension,
  createToolSearchExtension,
  DEFAULT_COMPACTION_SETTINGS,
  getLastAssistantUsage,
  ModelRuntime,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { GondolinSession } from "@agent-workload-platform/gondolin-session";

import { parseVoiceTurn, VOICE_TURN_ORIGIN_CUSTOM_TYPE } from "./conversation.js";
import {
  assistantText,
  createGrafanaMcpRegistration,
  createJournalReviewMcpRegistration,
  createPlaywrightTraceMcpRegistration,
  createRemoteTaskSessionRegistration,
  createWassetteMcpRegistration,
  isolatedVoiceMcpConfig,
  PLAYWRIGHT_TRACE_TOOLS,
  skillResourceLoader,
} from "./pi-session.js";
import {
  PublicTranscript,
  type PublicTranscriptEntry,
  type PublicTranscriptSnapshot,
  publicSessionTranscript,
  restorePublicTranscript,
} from "./public-transcript.js";
import { createSerialExecutor } from "./serial-executor.js";
import { createVoiceGondolinSession } from "./voice-gondolin.js";
import type { ServiceSettings } from "./voice-config.js";
import {
  listVoiceSessions,
  openVoiceSessionManager,
  type PublicSessionSummary,
  readVoiceSession,
} from "./voice-sessions.js";
import { RemoteTaskSession } from "./remote-task-session.js";

type GondolinTools = Awaited<ReturnType<GondolinSession["codingTools"]>>;
type VoiceAgentSettings = Pick<
  ServiceSettings,
  | "agentDir"
  | "cwd"
  | "grafanaMcpToken"
  | "grafanaMcpUrl"
  | "playwrightTraceArtifactRoot"
  | "playwrightTraceOutputRoot"
  | "playwrightTraceRenderer"
  | "playwrightTraceViewerBaseUrl"
  | "remoteTaskSocketDir"
  | "model"
  | "sessionDir"
  | "skillsDir"
  | "thinking"
  | "timeoutMs"
  | "wassetteBin"
  | "wassetteComponentDir"
  | "wassetteEnvFile"
>;

export type PublicContextUsage = {
  tokens: number | null;
  contextWindow: number | null;
  percent: number | null;
  estimated: boolean;
  canCompact: boolean;
};

type VoiceSessionState =
  | { kind: "unbound"; manager: SessionManager; systemPrompt: string }
  | {
    kind: "active";
    session: AgentSession;
    systemPrompt: string;
    unsubscribe: () => void;
  }
  | { kind: "closed" };

// Keep this as an additive selection. Passing plain tool names makes Pi treat
// the list as an allowlist; once any mcp__ name is present, every other MCP
// tool is discarded, including Wassette's deferred tools. Additive entries
// preserve the MCP registry while still making the voice tools available.
export const VOICE_INITIAL_TOOLS = [
  "+read",
  "+write",
  "+edit",
  "+bash",
  "+tool_search",
  "+mcp__grafana__search_tempo_traces",
  "+mcp__grafana__get_tempo_trace",
  ...PLAYWRIGHT_TRACE_TOOLS.map((name) => `+${name}`),
  "+mcp__journal_review__render_journal_review",
  "+mcp__journal_review__review_active",
  "+mcp__journal_review__navigate_review",
  "+mcp__journal_review__get_review_status",
  "+attach_task_session",
] as const;

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

function runtimeSettings(settings: ServiceSettings): VoiceAgentSettings {
  return {
    agentDir: settings.agentDir,
    cwd: settings.cwd,
    grafanaMcpToken: settings.grafanaMcpToken,
    grafanaMcpUrl: settings.grafanaMcpUrl,
    playwrightTraceArtifactRoot: settings.playwrightTraceArtifactRoot,
    playwrightTraceOutputRoot: settings.playwrightTraceOutputRoot,
    playwrightTraceRenderer: settings.playwrightTraceRenderer,
    playwrightTraceViewerBaseUrl: settings.playwrightTraceViewerBaseUrl,
    remoteTaskSocketDir: settings.remoteTaskSocketDir,
    model: settings.model,
    sessionDir: settings.sessionDir,
    skillsDir: settings.skillsDir,
    thinking: settings.thinking,
    timeoutMs: settings.timeoutMs,
    wassetteBin: settings.wassetteBin,
    wassetteComponentDir: settings.wassetteComponentDir,
    wassetteEnvFile: settings.wassetteEnvFile,
  };
}

export class VoiceAgent {
  private sessionState: VoiceSessionState;
  private readonly transcript: PublicTranscript;
  private activeAssistantId?: string;
  private readonly operations = createSerialExecutor();
  private activeDeltaSink?: (delta: string) => void;
  private estimatedContextTokens?: number;
  private compacting = false;
  private readonly remoteTask: RemoteTaskSession;

  private constructor(
    private readonly settings: VoiceAgentSettings,
    private readonly modelRuntime: ModelRuntime,
    private readonly gondolin: GondolinSession,
    private readonly gondolinTools: GondolinTools,
    private persistedContextTokens: number | null,
    private persistedContextWindow: number | null,
    persistedSession: SessionManager,
    transcript: PublicTranscript,
  ) {
    this.sessionState = { kind: "unbound", manager: persistedSession, systemPrompt: "" };
    this.transcript = transcript;
    this.remoteTask = new RemoteTaskSession(settings.remoteTaskSocketDir, settings.timeoutMs);
  }

  static async create(settings: ServiceSettings): Promise<VoiceAgent> {
    const modelRuntime = await ModelRuntime.create({
      authPath: join(settings.agentDir, "auth.json"),
      modelsPath: join(settings.agentDir, "models.json"),
      modelsStorePath: join(settings.agentDir, "models-store.json"),
      allowModelNetwork: false,
    });
    const gondolin = await createVoiceGondolinSession({
      giteaEndpointUrl: settings.giteaEndpointUrl,
      giteaOwner: settings.giteaOwner,
      giteaRepository: settings.giteaRepository,
      giteaToken: settings.giteaToken,
      imagePath: settings.gondolinAssets,
      oxigraphUrl: settings.oxigraphUrl,
      prometheusEndpointUrl: settings.prometheusEndpointUrl,
      skillsDir: settings.skillsDir,
      s3MockAccessKey: settings.s3MockAccessKey,
      s3MockBucket: settings.s3MockBucket,
      s3MockEndpointUrl: settings.s3MockEndpointUrl,
      s3MockSecretKey: settings.s3MockSecretKey,
      sessionLabel: "pi-voice",
    });
    const gondolinTools = await gondolin.codingTools(settings.cwd);
    const persistedSession = openVoiceSessionManager(settings.cwd, settings.sessionDir);
    const entries = persistedSession.getEntries();
    const persistedUsage = getLastAssistantUsage(entries);
    const modelChange = [...entries].reverse().find((entry) => entry.type === "model_change");
    const persistedModel = modelChange?.type === "model_change"
      ? modelRuntime.getModel(modelChange.provider, modelChange.modelId)
      : undefined;
    return new VoiceAgent(
      runtimeSettings(settings),
      modelRuntime,
      gondolin,
      gondolinTools,
      persistedUsage ? calculateContextTokens(persistedUsage) : null,
      persistedModel?.contextWindow ?? null,
      persistedSession,
      restorePublicTranscript(persistedSession),
    );
  }

  private currentManager(): SessionManager {
    if (this.sessionState.kind === "active") return this.sessionState.session.sessionManager;
    if (this.sessionState.kind === "unbound") return this.sessionState.manager;
    throw new Error("Pi voice agent is closed");
  }

  private activeSession(): AgentSession | undefined {
    return this.sessionState.kind === "active" ? this.sessionState.session : undefined;
  }

  private replaceWithUnbound(manager: SessionManager, systemPrompt = ""): void {
    if (this.sessionState.kind === "active") {
      this.sessionState.unsubscribe();
      this.sessionState.session.dispose();
    }
    this.sessionState = { kind: "unbound", manager, systemPrompt };
  }

  private async newSession(systemPrompt: string): Promise<void> {
    const sessionManager = this.currentManager();
    this.replaceWithUnbound(sessionManager, systemPrompt);
    const resourceLoader = await skillResourceLoader(systemPrompt, this.settings, [
      createToolSearchExtension(),
      createMcpExtension({
        loadConfig: isolatedVoiceMcpConfig,
        logPath: join(this.settings.agentDir, "mcp.log"),
      }),
      createWassetteMcpRegistration(this.settings),
      createGrafanaMcpRegistration(this.settings),
      createPlaywrightTraceMcpRegistration(this.settings),
      createJournalReviewMcpRegistration(),
      createRemoteTaskSessionRegistration(this.remoteTask),
    ]);
    const model = this.settings.model
      ? this.modelRuntime.getModel(this.settings.model.provider, this.settings.model.modelId)
      : undefined;
    if (this.settings.model && !model) {
      throw new Error(`Pi voice model is unavailable: ${this.settings.model.source}`);
    }
    const { session } = await createAgentSession({
      cwd: this.settings.cwd,
      agentDir: this.settings.agentDir,
      modelRuntime: this.modelRuntime,
      model,
      thinkingLevel: this.settings.thinking,
      tools: [...VOICE_INITIAL_TOOLS],
      customTools: this.gondolinTools,
      resourceLoader,
      sessionManager,
    });
    const unsubscribe = session.subscribe((event) => {
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
        const usage = session.getContextUsage();
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
    this.sessionState = { kind: "active", session, systemPrompt, unsubscribe };
    await session.bindExtensions({});
  }

  transcriptSnapshot(): PublicTranscriptSnapshot {
    return this.transcript.snapshot();
  }

  async sessionCatalog(): Promise<{ sessions: PublicSessionSummary[] }> {
    return {
      sessions: await listVoiceSessions(
        this.settings.cwd,
        this.settings.sessionDir,
        this.currentManager().getSessionId(),
      ),
    };
  }

  historicalSession(sessionId: string): PublicTranscriptSnapshot | undefined {
    return readVoiceSession(this.settings.cwd, this.settings.sessionDir, sessionId);
  }

  startFreshSession(): { id: string } {
    if (this.operations.isBusy()) {
      throw new Error("Pi is busy; stop or finish the active turn before starting a new session");
    }
    void this.remoteTask.detach();
    const manager = SessionManager.create(this.settings.cwd, this.settings.sessionDir);
    this.replaceWithUnbound(manager);
    this.persistedContextTokens = null;
    this.persistedContextWindow = null;
    this.estimatedContextTokens = undefined;
    this.transcript.reset();
    return { id: manager.getSessionId() };
  }

  resumeSession(sessionId: string): { id: string } | undefined {
    if (this.operations.isBusy()) {
      throw new Error("Pi is busy; stop or finish the active turn before resuming a session");
    }
    void this.remoteTask.detach();
    const path = SessionManager.findById(this.settings.cwd, sessionId, this.settings.sessionDir);
    if (!path) return undefined;
    const manager = SessionManager.open(path, this.settings.sessionDir, this.settings.cwd);
    const entries = manager.getEntries();
    const usage = getLastAssistantUsage(entries);
    const modelChange = [...entries].reverse().find((entry) => entry.type === "model_change");
    const model = modelChange?.type === "model_change"
      ? this.modelRuntime.getModel(modelChange.provider, modelChange.modelId)
      : undefined;
    this.replaceWithUnbound(manager);
    this.persistedContextTokens = usage ? calculateContextTokens(usage) : null;
    this.persistedContextWindow = model?.contextWindow ?? null;
    this.estimatedContextTokens = undefined;
    this.transcript.replace(publicSessionTranscript(manager.getBranch()));
    return { id: manager.getSessionId() };
  }

  contextSnapshot(): PublicContextUsage {
    const session = this.activeSession();
    const usage = session?.getContextUsage();
    const tokens = usage?.tokens ?? this.estimatedContextTokens ?? this.persistedContextTokens;
    const contextWindow = usage?.contextWindow
      ?? session?.model?.contextWindow
      ?? this.persistedContextWindow;
    const percent = tokens !== null && contextWindow
      ? Math.min(100, (tokens / contextWindow) * 100)
      : null;
    const branch = this.currentManager().getBranch();
    const keepRecentTokens = session?.settingsManager.getCompactionKeepRecentTokens()
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
    return this.operations.run("maintenance", async () => {
      if (this.sessionState.kind === "closed") throw new Error("Pi voice agent is closed");
      if (this.sessionState.kind === "unbound") {
        await this.newSession(this.sessionState.systemPrompt);
      }
      const session = this.activeSession();
      if (!session) throw new Error("Pi voice session is unavailable");
      this.compacting = true;
      try {
        const result = await session.compact();
        this.estimatedContextTokens = result.estimatedTokensAfter;
        this.persistedContextTokens = result.estimatedTokensAfter ?? null;
        this.persistedContextWindow = session.model?.contextWindow ?? null;
        return this.contextSnapshot();
      } finally {
        this.compacting = false;
      }
    });
  }

  private runTurn(rawMessages: unknown, onDelta?: (delta: string) => void): Promise<string> {
    return this.operations.run("turn", async () => {
      const { systemPrompt, prompt, origin } = parseVoiceTurn(rawMessages);
      if (this.remoteTask.attachedTaskId) {
        this.transcript.addUser(prompt);
        const assistantId = this.transcript.beginAssistant();
        let streamed = "";
        try {
          const text = await this.remoteTask.send(prompt, (delta) => {
            streamed += delta;
            this.transcript.appendAssistantText(assistantId, delta);
            onDelta?.(delta);
          });
          if (text.startsWith(streamed) && text.length > streamed.length) {
            const remainder = text.slice(streamed.length);
            this.transcript.appendAssistantText(assistantId, remainder);
            onDelta?.(remainder);
          }
          return text;
        } finally {
          this.transcript.finishAssistant(assistantId);
        }
      }
      if (this.sessionState.kind !== "active" || this.sessionState.systemPrompt !== systemPrompt) {
        await this.newSession(systemPrompt);
      }
      const session = this.activeSession();
      if (!session) throw new Error("Pi voice session is unavailable");

      this.transcript.addUser(prompt);
      this.activeDeltaSink = onDelta;
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        void session.abort();
      }, this.settings.timeoutMs);
      try {
        session.sessionManager.appendCustomEntry(VOICE_TURN_ORIGIN_CUSTOM_TYPE, { origin });
        await session.prompt(prompt, { expandPromptTemplates: false, source: "rpc" });
        await session.waitForIdle();
      } finally {
        clearTimeout(timeout);
        this.activeDeltaSink = undefined;
      }
      if (timedOut) throw new Error("Pi voice turn timed out");
      return assistantText(session);
    });
  }

  turn(rawMessages: unknown): Promise<string> {
    return this.runTurn(rawMessages);
  }

  streamTurn(rawMessages: unknown, onDelta: (delta: string) => void): Promise<string> {
    return this.runTurn(rawMessages, onDelta);
  }

  async abort(): Promise<void> {
    if (this.remoteTask.attachedTaskId) await this.remoteTask.abort();
    else await this.activeSession()?.abort();
  }

  async detachTaskSession(): Promise<void> {
    await this.remoteTask.detach();
  }

  async close(): Promise<void> {
    const session = this.activeSession();
    if (this.sessionState.kind === "active") this.sessionState.unsubscribe();
    this.sessionState = { kind: "closed" };
    if (session) {
      await session.abort().catch(() => undefined);
      session.dispose();
    }
    await this.remoteTask.detach();
    await this.gondolin.close();
  }
}
