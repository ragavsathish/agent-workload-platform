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
import { taskVmCheckpointPath, TaskVmLease } from "./task-vm-state.js";

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
  development: {
    docker: boolean;
    disk: string;
    vmm: "qemu" | "krun" | undefined;
    sessionStartHook: string | undefined;
  };
  networkEnabled: boolean;
  allowedHosts: string[];
  skillsDirectory: string | undefined;
  environment: Record<string, string>;
};
type ProjectVmConfig = {
  image?: string;
  memory?: string;
  cpus?: number;
  policy?: string;
  environment?: Record<string, string>;
  development?: {
    docker?: boolean;
    disk?: string;
    vmm?: "qemu" | "krun";
    sessionStartHook?: string;
  };
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
  if (raw.environment !== undefined &&
    (!record(raw.environment) || Object.entries(raw.environment).some(
      ([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string",
    ))) {
    throw new Error("gondolin.environment must map environment variable names to strings");
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
    if (raw.development.vmm !== undefined && raw.development.vmm !== "qemu" && raw.development.vmm !== "krun") {
      throw new Error('gondolin.development.vmm must be "qemu" or "krun"');
    }
    if (raw.development.vmm !== undefined && raw.development.docker !== true) {
      throw new Error("gondolin.development.vmm requires docker: true");
    }
    if (raw.development.sessionStartHook !== undefined &&
      (typeof raw.development.sessionStartHook !== "string" || !raw.development.sessionStartHook)) {
      throw new Error("gondolin.development.sessionStartHook must be a non-empty path");
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
  let sessionStartHook: string | undefined;
  if (config.development?.sessionStartHook) {
    if (!config.development.docker) {
      throw new Error("gondolin.development.sessionStartHook requires docker: true");
    }
    const requestedHookPath = path.resolve(projectDirectory, config.development.sessionStartHook);
    if (!insideDirectory(projectDirectory, requestedHookPath)) {
      throw new Error("gondolin.development.sessionStartHook must stay inside the task workspace");
    }
    const hookPath = fs.realpathSync(requestedHookPath);
    if (!insideDirectory(projectDirectory, hookPath) || !fs.statSync(hookPath).isFile()) {
      throw new Error("gondolin.development.sessionStartHook must be a file inside the task workspace");
    }
    sessionStartHook = `/workspace/${path.relative(projectDirectory, hookPath).split(path.sep).join("/")}`;
  }

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
      vmm: config.development?.vmm,
      sessionStartHook,
    },
    networkEnabled,
    allowedHosts,
    skillsDirectory: options.skillsDirectory,
    environment: config.environment ?? {},
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

function taskGiteaBridge(): { guest: URL; upstream: URL; owner: string; token?: string } | undefined {
  const endpoint = process.env.GITEA_ENDPOINT_URL;
  if (!endpoint) return undefined;
  const upstream = new URL(endpoint);
  if (upstream.protocol !== "http:" || upstream.hostname !== "127.0.0.1" || !upstream.port
    || upstream.pathname !== "/" || upstream.search || upstream.hash) {
    throw new Error("GITEA_ENDPOINT_URL must be an HTTP loopback origin with an explicit port");
  }
  const guest = new URL(`http://gitea.local:${upstream.port}`);
  const tokenFile = process.env.GITEA_REVIEW_TOKEN_FILE;
  const token = tokenFile ? fs.readFileSync(tokenFile, "utf8").trim() : undefined;
  if (tokenFile && !token) throw new Error("GITEA_REVIEW_TOKEN_FILE is empty");
  return { guest, upstream, owner: process.env.GITEA_OWNER || "source-publisher", token };
}

export default function gondolinSessionExtension(pi: ExtensionAPI): void {
  const projectDirectory = path.resolve(process.cwd());
  let session: GondolinSession | undefined;
  let codingTools: CodingTools | undefined;
  let sessionFile: string | undefined;
  let checkpointPath: string | undefined;
  let lease: TaskVmLease | undefined;
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

  const releaseActive = (): void => {
    lease?.release();
    lease = undefined;
    sessionFile = undefined;
    checkpointPath = undefined;
  };

  const checkpointActive = async (): Promise<void> => {
    const resource = session;
    const savedFile = sessionFile;
    const savedCheckpoint = checkpointPath;
    session = undefined;
    codingTools = undefined;
    try {
      if (resource && savedFile && savedCheckpoint && fs.existsSync(savedFile)) {
        await resource.checkpoint(savedCheckpoint);
      } else {
        await resource?.close();
      }
    } finally {
      releaseActive();
    }
  };

  const disposeActive = async (): Promise<void> => {
    const resource = session;
    const savedCheckpoint = checkpointPath;
    session = undefined;
    codingTools = undefined;
    try {
      await resource?.close();
      if (savedCheckpoint) fs.rmSync(savedCheckpoint, { force: true });
    } finally {
      releaseActive();
    }
  };

  for (const tool of deferredCodingTools(projectDirectory, activeCodingTools)) pi.registerTool(tool);

  pi.registerCommand("gondolin-dispose", {
    description: "Dispose this Pi task's Gondolin VM and saved guest disk, then exit",
    handler: async (_args, context) => {
      await disposeActive();
      context.ui.notify("Gondolin task VM and saved guest disk disposed", "info");
      context.shutdown();
    },
  });

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
      await checkpointActive();
      const configured = activeConfig();
      const devSession = configured.development.docker;
      const gitea = devSession && configured.networkEnabled ? taskGiteaBridge() : undefined;
      sessionFile = context.sessionManager.getSessionFile();
      checkpointPath = sessionFile ? taskVmCheckpointPath(sessionFile) : undefined;
      lease = checkpointPath ? TaskVmLease.acquire(checkpointPath) : undefined;
      session = new GondolinSession({
        imagePath: configured.imagePath,
        ...(devSession && configured.development.vmm
          ? { sandbox: { vmm: configured.development.vmm } }
          : {}),
        mounts: {
          "/workspace": projectDirectory,
          ...(devSession && process.env.GONDOLIN_DEV_IMAGE_CACHE
            ? { "/image-cache": {
              hostPath: path.resolve(process.env.GONDOLIN_DEV_IMAGE_CACHE),
              readonly: true,
            } }
            : {}),
          ...(devSession && process.env.GONDOLIN_DEV_IMAGE_STORE
            ? { "/image-store": {
              hostPath: path.resolve(process.env.GONDOLIN_DEV_IMAGE_STORE),
              readonly: true,
            } }
            : {}),
          ...(configured.skillsDirectory
            ? { "/skills": { hostPath: configured.skillsDirectory, readonly: true } }
            : {}),
        },
        network: configured.networkEnabled
          ? {
              allowedHosts: gitea
                ? [...new Set([...configured.allowedHosts, gitea.guest.hostname])]
                : configured.allowedHosts,
              ...(gitea ? {
                allowedInternalHosts: [gitea.upstream.hostname],
                onRequest: (request: Request) => {
                  const requested = new URL(request.url);
                  if (requested.hostname !== gitea.guest.hostname || requested.port !== gitea.guest.port) {
                    return request;
                  }
                  requested.protocol = gitea.upstream.protocol;
                  requested.hostname = gitea.upstream.hostname;
                  requested.port = gitea.upstream.port;
                  return new Request(requested, request);
                },
              } : {}),
            }
          : false,
        environment: {
          ...(devSession ? {
            PATH: "/opt/flutter/bin:/opt/flutter/bin/cache/dart-sdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            FLUTTER_HOME: "/opt/flutter",
            FLUTTER_ROOT: "/opt/flutter",
            PUB_CACHE: "/var/cache/pub",
            PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright",
          } : {}),
          ...(gitea ? { GITEA_BASE_URL: gitea.guest.origin, GITEA_OWNER: gitea.owner } : {}),
          ...configured.environment,
        },
        memory: configured.memory,
        cpus: configured.cpus,
        rootfs: { mode: "cow", ...(devSession ? { size: configured.development.disk } : {}) },
        maxHttpResponseBodyBytes: devSession ? 512 * 1024 * 1024 : undefined,
        startupCommands: devSession ? [
          ["/usr/local/bin/start-dev-docker"],
          ...(configured.development.sessionStartHook
            ? [[
                configured.development.sessionStartHook.endsWith(".clj")
                  ? "/usr/local/bin/bb"
                  : "/usr/local/bin/node",
                configured.development.sessionStartHook,
              ]]
            : []),
          ...(gitea?.token ? [[
            "/usr/local/bin/tea", "login", "add", "--name", "local", "--url",
            gitea.guest.origin, "--token", gitea.token, "--no-version-check",
          ]] : []),
        ] : undefined,
        sessionLabel: devSession ? "pi-dev-worktree" : "pi-agent-workload",
        resumeCheckpointPath: checkpointPath,
      });
      codingTools = await session.codingTools();
      context.ui.notify(
        `Loaded Gondolin coding tools (${configured.networkEnabled ? "policy-controlled egress" : "no public egress"})`,
        "info",
      );
    } catch (error) {
      const failedSession = session;
      session = undefined;
      codingTools = undefined;
      await failedSession?.close().catch(() => undefined);
      releaseActive();
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
    await checkpointActive();
  });
}
