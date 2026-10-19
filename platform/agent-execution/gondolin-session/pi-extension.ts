import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCodingTools,
  createMcpExtension,
  type ExtensionAPI,
  type McpTransportFactory,
} from "@earendil-works/pi-coding-agent";

import { GondolinSession } from "./session.js";

// Pi exposes custom MCP transport factories but not its default factory. Resolve the implementation
// beside Pi's public entry point so ordinary mcp.json servers continue to use Pi's native behavior.
const piMcpRuntime = await import(new URL(
  "./extensions/mcp/runtime.js",
  import.meta.resolve("@earendil-works/pi-coding-agent"),
).href) as { createDefaultTransport: McpTransportFactory };

type CodingTools = ReturnType<typeof createCodingTools>;
type ResolvedGondolinConfig = {
  imagePath: string;
  memory: string | undefined;
  cpus: number | undefined;
  development: { docker: boolean; disk: string };
  networkEnabled: boolean;
  allowedHosts: string[];
  skillsDirectory: string | undefined;
};
type ProjectVmConfig = {
  image?: string;
  memory?: string;
  cpus?: number;
  policy?: string;
  development?: { docker?: boolean; disk?: string };
};
const extensionDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = path.basename(extensionDir) === "dist"
  ? path.dirname(extensionDir)
  : extensionDir;
const repositoryRoot = path.resolve(runtimeDir, "..", "..", "..");
const architecture = os.arch() === "arm64" ? "aarch64" : os.arch() === "x64" ? "x86_64" : "unsupported";
const runtimePrompt = readCapabilityPrompt("runtime");
const skillsPrompt = readCapabilityPrompt("skills");
const networkEnabledPrompt = readCapabilityPrompt("network-enabled");
const networkDisabledPrompt = readCapabilityPrompt("network-disabled");

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonObject(filePath: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!record(parsed)) throw new Error(`${filePath} must contain a JSON object`);
  return parsed;
}

function readCapabilityPrompt(name: string): string {
  const filePath = path.join(extensionDir, "prompts", name, "APPEND_SYSTEM.md");
  const prompt = fs.readFileSync(filePath, "utf8").trim();
  if (!prompt) throw new Error(`${filePath} must not be empty`);
  return prompt;
}

function insideDirectory(directory: string, filePath: string): boolean {
  const relativePath = path.relative(directory, filePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function stringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry)) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  return value;
}

function resolveGondolinConfig(options: {
  projectDirectory: string;
  fallbackImagePath: string;
  skillsDirectory?: string;
  fallbackPublicInternet: boolean;
}): ResolvedGondolinConfig {
  const projectDirectory = fs.realpathSync(options.projectDirectory);
  const configPath = path.join(projectDirectory, ".pi", "gondolin.json");
  const raw = fs.existsSync(configPath) ? readJsonObject(configPath) : {};
  if (raw.image !== undefined && typeof raw.image !== "string") {
    throw new Error("gondolin.image must be a string");
  }
  if (raw.memory !== undefined && typeof raw.memory !== "string") {
    throw new Error("gondolin.memory must be a string");
  }
  if (raw.cpus !== undefined && (!Number.isInteger(raw.cpus) || Number(raw.cpus) < 1)) {
    throw new Error("gondolin.cpus must be a positive integer");
  }
  if (raw.policy !== undefined && typeof raw.policy !== "string") {
    throw new Error("gondolin.policy must be a string");
  }
  if (raw.development !== undefined && !record(raw.development)) {
    throw new Error("gondolin.development must be an object");
  }
  if (record(raw.development)) {
    if (raw.development.docker !== undefined && typeof raw.development.docker !== "boolean") {
      throw new Error("gondolin.development.docker must be a boolean");
    }
    if (raw.development.disk !== undefined &&
      (typeof raw.development.disk !== "string" || !/^\d+[MG]$/.test(raw.development.disk))) {
      throw new Error("gondolin.development.disk must be a size such as 64G");
    }
    if (typeof raw.development.disk === "string") {
      const amount = Number(raw.development.disk.slice(0, -1));
      const gibibytes = raw.development.disk.endsWith("G") ? amount : amount / 1024;
      if (!Number.isFinite(gibibytes) || gibibytes < 1 || gibibytes > 128) {
        throw new Error("gondolin.development.disk must be between 1G and 128G");
      }
    }
  }
  const config = raw as ProjectVmConfig;

  let networkEnabled = options.fallbackPublicInternet;
  let allowedHosts = networkEnabled ? ["*"] : [];
  if (config.policy) {
    const requestedPolicyPath = path.resolve(projectDirectory, config.policy);
    if (!insideDirectory(projectDirectory, requestedPolicyPath)) {
      throw new Error("gondolin.policy must stay inside the task workspace");
    }
    const policyPath = fs.realpathSync(requestedPolicyPath);
    if (!insideDirectory(projectDirectory, policyPath)) {
      throw new Error("gondolin.policy must not escape the task workspace through a symlink");
    }
    const policy = readJsonObject(policyPath);
    if (!record(policy.network)) throw new Error("gondolin policy must contain a network object");
    const network = policy.network;
    if (network.enabled !== undefined && typeof network.enabled !== "boolean") {
      throw new Error("network.enabled must be a boolean");
    }
    networkEnabled = typeof network.enabled === "boolean" ? network.enabled : true;
    allowedHosts = networkEnabled ? stringArray(network.allowedHosts, "network.allowedHosts") ?? [] : [];
  }

  return {
    imagePath: process.env.GONDOLIN_EXECUTION_IMAGE_REF || config.image || options.fallbackImagePath,
    memory: config.memory,
    cpus: config.cpus,
    development: {
      docker: config.development?.docker ?? false,
      disk: config.development?.disk ?? "64G",
    },
    networkEnabled,
    allowedHosts,
    skillsDirectory: options.skillsDirectory,
  };
}

function deferredCodingTools(
  projectDirectory: string,
  resolveTools: () => CodingTools,
): CodingTools {
  const definitions = createCodingTools(projectDirectory);
  return definitions.map((definition) => ({
    ...definition,
    async execute(toolCallId, params, signal, onUpdate) {
      const tool = resolveTools().find((candidate) => candidate.name === definition.name);
      if (!tool) throw new Error(`Gondolin coding capability is unavailable: ${definition.name}`);
      return tool.execute(toolCallId, params, signal, onUpdate);
    },
  }));
}

function runtimeInstructions(
  config: ResolvedGondolinConfig,
): string {
  return [
    runtimePrompt,
    ...(config.skillsDirectory ? [skillsPrompt] : []),
    config.networkEnabled ? networkEnabledPrompt : networkDisabledPrompt,
  ].join("\n");
}

export default function gondolinSessionExtension(pi: ExtensionAPI): void {
  const projectDirectory = path.resolve(process.cwd());
  let session: GondolinSession | undefined;
  let codingTools: CodingTools | undefined;
  let config: ResolvedGondolinConfig | undefined;
  let configurationError: Error | undefined;

  const activeConfig = (): ResolvedGondolinConfig => {
    if (configurationError) throw configurationError;
    if (!config) throw new Error("Gondolin Agent Session is not configured");
    return config;
  };

  const activeCodingTools = (): CodingTools => {
    activeConfig();
    if (!codingTools) throw new Error("Gondolin Agent Session has not started");
    return codingTools;
  };

  const activeSession = (): GondolinSession => {
    activeConfig();
    if (!session) throw new Error("Gondolin Agent Session has not started");
    return session;
  };

  const close = async (): Promise<void> => {
    const resource = session;
    session = undefined;
    codingTools = undefined;
    await resource?.close();
  };

  for (const tool of deferredCodingTools(projectDirectory, activeCodingTools)) pi.registerTool(tool);

  try {
    const devAssets = process.env.GONDOLIN_DEV_ASSETS;
    const fallbackImagePath = path.resolve(
      devAssets
        ?? process.env.GONDOLIN_BROWSER_ASSETS
        ?? path.join(repositoryRoot, "artifacts", "gondolin-browser", architecture),
    );
    config = resolveGondolinConfig({
      projectDirectory,
      fallbackImagePath,
      skillsDirectory: process.env.PI_TASK_SKILLS_DIR,
      fallbackPublicInternet: process.env.GONDOLIN_PUBLIC_INTERNET === "1",
    });
  } catch (error) {
    configurationError = asError(error);
  }

  pi.on("session_start", async (_event, context) => {
    try {
      const configured = activeConfig();
      const devSession = configured.development.docker;
      session = new GondolinSession({
        imagePath: configured.imagePath,
        mounts: {
          "/workspace": projectDirectory,
          ...(devSession && process.env.GONDOLIN_DEV_IMAGE_CACHE
            ? { "/image-cache": {
              hostPath: path.resolve(process.env.GONDOLIN_DEV_IMAGE_CACHE),
              readonly: true,
            } }
            : {}),
          ...(configured.skillsDirectory
            ? { "/skills": { hostPath: configured.skillsDirectory, readonly: true } }
            : {}),
        },
        network: configured.networkEnabled
          ? { allowedHosts: configured.allowedHosts }
          : false,
        environment: devSession ? {
          PATH: "/opt/flutter/bin:/opt/flutter/bin/cache/dart-sdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
          FLUTTER_HOME: "/opt/flutter",
          FLUTTER_ROOT: "/opt/flutter",
          PUB_CACHE: "/var/cache/pub",
          PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright",
        } : undefined,
        memory: configured.memory,
        cpus: configured.cpus,
        rootfs: devSession ? { mode: "cow", size: configured.development.disk } : undefined,
        maxHttpResponseBodyBytes: devSession ? 512 * 1024 * 1024 : undefined,
        startupCommands: devSession ? [["/usr/local/bin/start-dev-docker"]] : undefined,
        sessionLabel: devSession ? "pi-dev-worktree" : "pi-agent-workload",
      });
      codingTools = await session.codingTools();
      context.ui.notify(
        `Loaded Gondolin coding tools (${configured.networkEnabled ? "policy-controlled egress" : "no public egress"})`,
        "info",
      );
    } catch (error) {
      await close().catch(() => undefined);
      context.ui.notify(asError(error).message, "error");
      throw error;
    }
  });

  pi.on("user_bash", async () => {
    activeCodingTools();
    return { operations: await activeSession().bashOperations(projectDirectory) };
  });

  pi.on("before_agent_start", (event) => {
    activeCodingTools();
    event.systemPromptOptions.sections.gondolin_runtime = runtimeInstructions(activeConfig());
  });

  if (process.env.GONDOLIN_BROWSER_TOOLS === "1") {
    pi.registerMcpServer("playwright", {
      command: "gondolin-playwright",
      exposure: "direct",
      description: "Control Chromium inside the Gondolin agent session.",
    });
    void createMcpExtension({
      createTransport: (entry, cwd, authProvider) => {
        if (entry.name === "playwright" && entry.scope === "extension") {
          return activeSession().playwrightTransport();
        }
        return piMcpRuntime.createDefaultTransport(entry, cwd, authProvider);
      },
    })(pi);
  }

  pi.on("session_shutdown", async () => {
    await close();
  });
}
