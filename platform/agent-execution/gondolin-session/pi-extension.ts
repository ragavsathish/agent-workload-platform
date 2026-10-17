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
import { parse } from "smol-toml";

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
  networkEnabled: boolean;
  allowedHosts: string[];
  skillsDirectory: string | undefined;
};
type ProjectVmConfig = {
  image?: string;
  memory?: string;
  cpus?: number;
  policy?: string;
};
type RuntimePromptLayers = {
  runtime: string;
  skills: string;
  isolation: string;
  network_enabled: string;
  network_disabled: string;
};

const extensionDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = path.basename(extensionDir) === "dist"
  ? path.dirname(extensionDir)
  : extensionDir;
const repositoryRoot = path.resolve(runtimeDir, "..", "..", "..");
const architecture = os.arch() === "arm64" ? "aarch64" : os.arch() === "x64" ? "x86_64" : "unsupported";
const runtimePromptKeys = [
  "runtime",
  "skills",
  "isolation",
  "network_enabled",
  "network_disabled",
] as const satisfies readonly (keyof RuntimePromptLayers)[];

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

function readRuntimePrompt(filePath: string): RuntimePromptLayers {
  const parsed: unknown = parse(fs.readFileSync(filePath, "utf8"));
  if (!record(parsed) || !record(parsed.layers)) {
    throw new Error(`${filePath} must contain a layers table`);
  }
  const keys = Object.keys(parsed.layers);
  if (keys.length !== runtimePromptKeys.length
    || runtimePromptKeys.some((key) => !keys.includes(key))) {
    throw new Error(`${filePath} must define exactly: ${runtimePromptKeys.join(", ")}`);
  }
  for (const key of runtimePromptKeys) {
    if (typeof parsed.layers[key] !== "string" || !parsed.layers[key].trim()) {
      throw new Error(`${filePath} layer ${key} must be a non-empty string`);
    }
  }
  return parsed.layers as RuntimePromptLayers;
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
    imagePath: config.image || options.fallbackImagePath,
    memory: config.memory,
    cpus: config.cpus,
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
  layers: RuntimePromptLayers,
): string {
  return [
    layers.runtime,
    ...(config.skillsDirectory ? [layers.skills] : []),
    layers.isolation,
    config.networkEnabled ? layers.network_enabled : layers.network_disabled,
  ].join("\n");
}

export default function gondolinSessionExtension(pi: ExtensionAPI): void {
  const projectDirectory = path.resolve(process.cwd());
  let session: GondolinSession | undefined;
  let codingTools: CodingTools | undefined;
  let config: ResolvedGondolinConfig | undefined;
  let prompt: RuntimePromptLayers | undefined;
  let configurationError: Error | undefined;

  const activeConfig = (): ResolvedGondolinConfig => {
    if (configurationError) throw configurationError;
    if (!config) throw new Error("Gondolin Agent Session is not configured");
    return config;
  };

  const activePrompt = (): RuntimePromptLayers => {
    if (configurationError) throw configurationError;
    if (!prompt) throw new Error("Gondolin Agent Session prompt is not configured");
    return prompt;
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
    const fallbackImagePath = path.resolve(
      process.env.GONDOLIN_BROWSER_ASSETS
        ?? path.join(repositoryRoot, "artifacts", "gondolin-browser", architecture),
    );
    config = resolveGondolinConfig({
      projectDirectory,
      fallbackImagePath,
      skillsDirectory: process.env.PI_TASK_SKILLS_DIR,
      fallbackPublicInternet: process.env.GONDOLIN_PUBLIC_INTERNET === "1",
    });
    prompt = readRuntimePrompt(path.join(extensionDir, "prompt.toml"));
  } catch (error) {
    configurationError = asError(error);
  }

  pi.on("session_start", async (_event, context) => {
    try {
      const configured = activeConfig();
      session = new GondolinSession({
        imagePath: configured.imagePath,
        mounts: {
          "/workspace": projectDirectory,
          ...(configured.skillsDirectory
            ? { "/skills": { hostPath: configured.skillsDirectory, readonly: true } }
            : {}),
        },
        network: configured.networkEnabled
          ? { allowedHosts: configured.allowedHosts }
          : false,
        memory: configured.memory,
        cpus: configured.cpus,
        sessionLabel: "pi-agent-workload",
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
    return {
      systemPrompt: `${event.systemPrompt}\n\n${runtimeInstructions(activeConfig(), activePrompt())}`,
    };
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
