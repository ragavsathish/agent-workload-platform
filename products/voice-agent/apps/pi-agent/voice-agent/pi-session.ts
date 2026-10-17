import { isAbsolute, posix, relative, sep } from "node:path";

import {
  DefaultResourceLoader,
  type AgentSession,
  type ExtensionAPI,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";

import { GUEST_SKILLS } from "./voice-gondolin.js";
import type { ServiceSettings } from "./voice-config.js";

const WASSETTE_SYSTEM_PROMPT = `Wassette provides capability-controlled WebAssembly tools through MCP.
Use tool_search when a request could benefit from a Wassette component. Components start without
host capabilities: grant only the minimum capability needed for the current request, and never grant
access to orchestrator credentials, the Pi agent directory, or unrelated host files. The preconfigured
tasking component provides submission, status, and cancellation tools for durable work.`;

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
