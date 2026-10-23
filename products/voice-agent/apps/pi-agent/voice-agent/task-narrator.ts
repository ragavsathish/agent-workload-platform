import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

import { assistantText } from "./pi-session.js";
import type { ServiceSettings } from "./voice-config.js";

export type NarrationRequest = {
  taskId: string;
  instruction: string;
  events: string[];
};

const SYSTEM_PROMPT = readFileSync(
  new URL("./prompts/task-narrator/SYSTEM.md", import.meta.url),
  "utf8",
).trim();
if (!SYSTEM_PROMPT) throw new Error("Pi task narration system prompt must not be empty");

export function narrationPrompt(request: NarrationRequest): string {
  return `Task goal: ${request.instruction}\n\nRecent observable events:\n${request.events
    .map((event, index) => `${index + 1}. ${event}`)
    .join("\n")}`;
}

export class TaskNarrator {
  private constructor(
    private readonly settings: Pick<ServiceSettings, "agentDir" | "cwd" | "model" | "timeoutMs">,
    private readonly runtime: ModelRuntime,
  ) {}

  static async create(settings: ServiceSettings): Promise<TaskNarrator> {
    const runtime = await ModelRuntime.create({
      authPath: join(settings.agentDir, "auth.json"),
      modelsPath: join(settings.agentDir, "models.json"),
      modelsStorePath: join(settings.agentDir, "models-store.json"),
      allowModelNetwork: false,
    });
    return new TaskNarrator(settings, runtime);
  }

  async summarize(request: NarrationRequest): Promise<string> {
    const model = this.settings.model
      ? this.runtime.getModel(this.settings.model.provider, this.settings.model.modelId)
      : undefined;
    if (this.settings.model && !model) throw new Error("Pi narration model is unavailable");
    const resourceLoader = new DefaultResourceLoader({
      cwd: this.settings.cwd,
      agentDir: this.settings.agentDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: SYSTEM_PROMPT,
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd: this.settings.cwd,
      agentDir: this.settings.agentDir,
      modelRuntime: this.runtime,
      model,
      thinkingLevel: "off",
      tools: [],
      noTools: "all",
      resourceLoader,
      sessionManager: SessionManager.inMemory(this.settings.cwd),
    });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      void session.abort();
    }, Math.min(this.settings.timeoutMs, 45_000));
    try {
      await session.prompt(narrationPrompt(request), {
        expandPromptTemplates: false,
        source: "rpc",
      });
      await session.waitForIdle();
      if (timedOut) throw new Error("Pi narration timed out");
      const spoken = assistantText(session).trim();
      if (!spoken || spoken.length > 500) throw new Error("Pi narration was invalid");
      return spoken;
    } finally {
      clearTimeout(timeout);
      session.dispose();
    }
  }
}
