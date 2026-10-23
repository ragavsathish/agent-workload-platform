import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";

import {
  DefaultResourceLoader,
  SettingsManager,
  type AgentSession,
  type ExtensionAPI,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { GUEST_SKILLS } from "./voice-gondolin.js";
import type { ServiceSettings } from "./voice-config.js";

// These are direct package dependencies. Avoid require.resolve here: the host
// sandbox installs module hooks before a voice session is created, and Node's
// resolver can re-enter those hooks indefinitely for workspace-package links.
export const PLAYWRIGHT_TRACE_TOOLS = [
  "mcp__playwright_traces__search_playwright_traces",
  "mcp__playwright_traces__render_playwright_trace",
] as const;
const GRAFANA_TRACE_TOOLS = [
  "mcp__grafana__search_tempo_traces",
  "mcp__grafana__get_tempo_trace",
] as const;
const JOURNAL_REVIEW_MCP_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "vendor",
  "journal-review-mcp",
);
const JOURNAL_REVIEW_MCP_SERVER = join(JOURNAL_REVIEW_MCP_ROOT, "stdio-bundle.mjs");
const JOURNAL_REVIEW_TOOLS = [
  "mcp__journal_review__render_journal_review",
  "mcp__journal_review__review_active",
  "mcp__journal_review__navigate_review",
  "mcp__journal_review__get_review_status",
] as const;

function capabilityPrompt(name: string): string {
  const prompt = readFileSync(
    new URL(`./prompts/${name}/APPEND_SYSTEM.md`, import.meta.url),
    "utf8",
  ).trim();
  if (!prompt) throw new Error(`Pi capability prompt ${name} must not be empty`);
  return prompt;
}

const PLAYWRIGHT_TRACE_SYSTEM_PROMPT = capabilityPrompt("playwright-trace");
const WASSETTE_SYSTEM_PROMPT = capabilityPrompt("wassette");
const GRAFANA_SYSTEM_PROMPT = capabilityPrompt("grafana-trace");
const MUSIC_SYSTEM_PROMPT = capabilityPrompt("music");
const JOURNAL_REVIEW_SYSTEM_PROMPT = capabilityPrompt("journal-review");
const OXIGRAPH_CLI_SYSTEM_PROMPT = capabilityPrompt("oxigraph-cli");
const REMOTE_TASK_SYSTEM_PROMPT = capabilityPrompt("remote-task");

const SCRUBBED_WASSETTE_ENV = {
  AGENT_GATEWAY_TOKEN: "",
  ARTIFACT_ACCESS_KEY: "",
  ARTIFACT_SECRET_KEY: "",
  AWS_ACCESS_KEY_ID: "",
  AWS_SECRET_ACCESS_KEY: "",
  AWS_SESSION_TOKEN: "",
  DATABASE_URL: "",
  DIGITAL_TWIN_READER_TOKEN: "",
  GITEA_TOKEN: "",
  GITHUB_TOKEN: "",
  INFERENCE_BROKER_TOKEN: "",
  KNOWLEDGE_GATEWAY_TOKEN: "",
  ORCHESTRATOR_APPROVAL_SECRET: "",
  TASK_GATEWAY_TOKEN: "",
};

export function createWassetteMcpRegistration(
  settings: Pick<
    ServiceSettings,
    | "cwd"
    | "wassetteBin"
    | "wassetteComponentDir"
    | "wassetteEnvFile"
  >,
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.registerMcpServer("wassette", {
      command: settings.wassetteBin,
      args: [
        "run",
        "--component-dir",
        settings.wassetteComponentDir,
        "--env-file",
        settings.wassetteEnvFile,
      ],
      cwd: settings.cwd,
      env: { ...SCRUBBED_WASSETTE_ENV },
      exposure: "deferred",
      description: "Run capability-controlled WebAssembly components with Wassette.",
      timeout: 60,
    });
    pi.on("before_agent_start", (event) => {
      event.systemPromptOptions.sections.wassette = WASSETTE_SYSTEM_PROMPT;
      event.systemPromptOptions.sections.music = MUSIC_SYSTEM_PROMPT;
    });
  };
}

export function createRemoteTaskSessionRegistration(remote: {
  attach(taskId: string): Promise<{ taskId: string; isStreaming: boolean }>;
}): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.on("before_agent_start", (event) => {
      event.systemPromptOptions.sections.remote_task = REMOTE_TASK_SYSTEM_PROMPT;
    });
    pi.registerTool({
      name: "attach_task_session",
      label: "Attach task session",
      description: "Attach this voice conversation to one currently running durable Pi task.",
      parameters: Type.Object({
        task_id: Type.String({
          description: "The exact lowercase UUID task_id returned after task approval.",
          minLength: 36,
          maxLength: 36,
        }),
      }),
      execute: async (_toolCallId, params) => {
        const state = await remote.attach(params.task_id);
        return {
          content: [{
            type: "text",
            text: state.isStreaming
              ? `Attached to running task ${state.taskId}. The next owner turn goes directly to it.`
              : `Attached to task ${state.taskId}. The next owner turn goes directly to it.`,
          }],
          details: state,
        };
      },
    });
  };
}

export function createGrafanaMcpRegistration(
  settings: Pick<ServiceSettings, "grafanaMcpToken" | "grafanaMcpUrl">,
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.registerMcpServer("grafana", {
      url: settings.grafanaMcpUrl,
      headers: { Authorization: `Bearer ${settings.grafanaMcpToken}` },
      exposure: "direct",
      description: "Read Grafana dashboards, Prometheus metrics, and Tempo traces.",
      timeout: 30,
    });
    pi.on("before_agent_start", (event) => {
      event.systemPromptOptions.sections.grafana_trace = GRAFANA_SYSTEM_PROMPT;
      const available = new Set(pi.getAllTools().map((tool) => tool.name));
      const active = pi.getActiveTools();
      const additions = GRAFANA_TRACE_TOOLS.filter(
        (name) => available.has(name) && !active.includes(name),
      );
      if (additions.length > 0) pi.setActiveTools([...active, ...additions]);
    });
  };
}

export function createPlaywrightTraceMcpRegistration(
  settings: Pick<
    ServiceSettings,
    "playwrightTraceViewerBaseUrl"
  >,
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.registerMcpServer("playwright-traces", {
      url: `${settings.playwrightTraceViewerBaseUrl.replace(/\/$/u, "")}/mcp`,
      exposure: "direct",
      description: "Search retained Playwright recordings and render the selected trace in Trace Viewer.",
      timeout: 600,
    });
    pi.on("before_agent_start", (event) => {
      event.systemPromptOptions.sections.playwright_trace = PLAYWRIGHT_TRACE_SYSTEM_PROMPT;
      const available = new Set(pi.getAllTools().map((tool) => tool.name));
      const active = pi.getActiveTools();
      const additions = PLAYWRIGHT_TRACE_TOOLS.filter(
        (name) => available.has(name) && !active.includes(name),
      );
      if (additions.length > 0) pi.setActiveTools([...active, ...additions]);
    });
  };
}

export function createJournalReviewMcpRegistration(): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.registerMcpServer("journal-review", {
      command: process.execPath,
      args: [JOURNAL_REVIEW_MCP_SERVER, "--stdio"],
      env: { JOURNAL_REVIEW_APP_HTML: join(JOURNAL_REVIEW_MCP_ROOT, "app", "main.html") },
      exposure: "direct",
      description: "Render and update the active cognitive-journal review with exact evidence spans.",
      timeout: 30,
    });
    pi.on("before_agent_start", (event) => {
      event.systemPromptOptions.sections.journal_review = JOURNAL_REVIEW_SYSTEM_PROMPT;
      const available = new Set(pi.getAllTools().map((tool) => tool.name));
      const active = pi.getActiveTools();
      const additions = JOURNAL_REVIEW_TOOLS.filter(
        (name) => available.has(name) && !active.includes(name),
      );
      if (additions.length > 0) pi.setActiveTools([...active, ...additions]);
    });
  };
}

/** Voice MCP is explicit: shared user or project mcp.json files must not override its policy. */
export function isolatedVoiceMcpConfig() {
  return { servers: [], errors: [] };
}

export function assistantText(session: AgentSession): string {
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
  const settingsManager = SettingsManager.inMemory({}, { projectTrusted: false });
  const loader = new DefaultResourceLoader({
    cwd: settings.cwd,
    agentDir: settings.agentDir,
    settingsManager,
    systemPrompt,
    appendSystemPrompt: [OXIGRAPH_CLI_SYSTEM_PROMPT],
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
  // The Pi package manager auto-discovers ~/.agents/skills even when default
  // skills are disabled. Keep that synchronous scan away from the user's
  // global skill tree; Voice exposes only the explicitly mounted skill set.
  const previousHome = process.env.HOME;
  process.env.HOME = join(settings.agentDir, ".voice-resource-home");
  try {
    await loader.reload();
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
  return loader;
}
