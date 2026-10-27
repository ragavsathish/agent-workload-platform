import { readFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { arch } from "node:os";
import { join, resolve, sep } from "node:path";
import { GondolinSession, guestHookCommand, resolveGuestHook, resolveGuestHooks,
  rewriteGiteaRepositoryRequest } from "@agent-workload-platform/gondolin-session";
import type { GondolinSessionOptions } from "@agent-workload-platform/gondolin-session";
import type { Models } from "@earendil-works/pi-ai";
import { GondolinExecutionEnv } from "./gondolin-env.js";
import { DurableTaskSession, type ModelRef } from "./runtime.js";
import type { McpServerConfig } from "./mcp-tools.js";
import { RemoteTaskBridge } from "./remote-session.js";

export type PiSessionInput = {
  taskId: string;
  workspace: string;
  instruction: string;
  imageRef?: string | null;
  giteaRepository?: string;
  onProgress?: (spoken: string) => void;
  signal?: AbortSignal;
};

async function taskGitea(repository: string | undefined): Promise<{
  guest: URL; upstream: URL; owner: string; repository: string; username: string; token: string;
} | undefined> {
  if (!repository) return undefined;
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(repository)) {
    throw new Error("task Gitea repository is invalid");
  }
  const directory = process.env.GITEA_TASK_TOKEN_DIR;
  if (!directory) throw new Error("GITEA_TASK_TOKEN_DIR is required for repository VM tasks");
  const token = (await readFile(join(directory, `gitea-task-${repository}-token`), "utf8")).trim();
  if (!token) throw new Error("repository VM Gitea token is empty");
  const upstream = new URL(process.env.GITEA_ENDPOINT_URL ?? "");
  if (upstream.protocol !== "http:" || upstream.hostname !== "127.0.0.1" || !upstream.port
      || upstream.pathname !== "/" || upstream.search || upstream.hash) {
    throw new Error("GITEA_ENDPOINT_URL must be a loopback HTTP origin");
  }
  return {
    guest: new URL(`http://gitea.local:${upstream.port}`), upstream,
    owner: process.env.GITEA_OWNER ?? "source-publisher", repository,
    username: `vm-${createHash("sha256").update(repository).digest("hex").slice(0, 20)}`,
    token,
  };
}
export type PiSessionDependencies = {
  models?: Models;
  createGondolinSession?: (options: GondolinSessionOptions) => GondolinSession;
};

function modelFromEnv(value: string | undefined): ModelRef | undefined {
  if (!value) return undefined;
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) throw new Error("PI_MODEL must use provider/model format");
  return { provider: value.slice(0, slash), modelId: value.slice(slash + 1) };
}

async function mcpServers(): Promise<McpServerConfig[] | undefined> {
  const file = process.env.PI_DURABLE_MCP_SERVERS_FILE;
  if (!file) return undefined;
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(parsed) || parsed.length > 8) throw new Error("Pi Durable MCP configuration must contain at most eight servers");
  return parsed as McpServerConfig[];
}

function gondolinPolicy(workspace: string): {
  image?: string; memory?: string; cpus?: number; network: false | { allowedHosts: string[] };
  giteaRepository?: string;
  startHooks: string[]; stopHook?: string;
  environment?: Record<string, string>;
  development?: { docker?: boolean; vmm?: "qemu" | "krun"; disk?: string; sessionStartHook?: string };
} {
  const configPath = join(workspace, ".pi", "gondolin.json");
  let config: Record<string, unknown> = {};
  try { config = JSON.parse(requireRead(configPath, "utf8")) as Record<string, unknown>; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const policyName = config.policy;
  let giteaRepository: string | undefined;
  if (config.gitea !== undefined) {
    if (!config.gitea || typeof config.gitea !== "object" || Array.isArray(config.gitea)) {
      throw new Error("gondolin.gitea must be an object");
    }
    const declaration = config.gitea as Record<string, unknown>;
    if (declaration.access !== "write" || typeof declaration.repository !== "string"
        || !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(declaration.repository)) {
      throw new Error("gondolin.gitea must declare a valid repository with write access");
    }
    if (declaration.pushOnStop !== undefined) throw new Error("Use gondolin.hooks.sessionStop instead of gitea.pushOnStop");
    giteaRepository = declaration.repository;
  }
  if (config.hooks !== undefined && (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks))) {
    throw new Error("gondolin.hooks must be an object");
  }
  const hooks = config.hooks as Record<string, unknown> | undefined;
  if (hooks?.sessionStop !== undefined && (typeof hooks.sessionStop !== "string" || !hooks.sessionStop)) {
    throw new Error("gondolin.hooks.sessionStop must be a non-empty path");
  }
  const development = config.development as { sessionStartHook?: string } | undefined;
  const startPath = hooks?.sessionStart ?? development?.sessionStartHook;
  const stopPath = hooks?.sessionStop;
  let network: false | { allowedHosts: string[] } = process.env.GONDOLIN_PUBLIC_INTERNET === "1"
    ? { allowedHosts: ["*"] } : false;
  if (typeof policyName === "string") {
    const policyPath = resolve(workspace, policyName);
    if (!policyPath.startsWith(`${resolve(workspace)}${sep}`)) throw new Error("Gondolin policy escapes workspace");
    const resolvedPolicy = realpathSync(policyPath);
    if (!resolvedPolicy.startsWith(`${realpathSync(workspace)}${sep}`)) {
      throw new Error("Gondolin policy escapes workspace through a symlink");
    }
    const policy = JSON.parse(requireRead(resolvedPolicy, "utf8")) as { network?: { enabled?: boolean; allowedHosts?: string[] } };
    network = policy.network?.enabled === false ? false : { allowedHosts: policy.network?.allowedHosts ?? [] };
  }
  return {
    image: typeof config.image === "string" ? config.image : undefined,
    giteaRepository,
    startHooks: resolveGuestHooks(workspace, startPath),
    stopHook: typeof stopPath === "string" ? resolveGuestHook(workspace, stopPath) : undefined,
    memory: typeof config.memory === "string" ? config.memory : undefined,
    cpus: typeof config.cpus === "number" ? config.cpus : undefined,
    environment: config.environment as Record<string, string> | undefined,
    development: config.development as { docker?: boolean; vmm?: "qemu" | "krun";
      disk?: string; sessionStartHook?: string } | undefined,
    network,
  };
}

// Keep synchronous policy reads local to VM construction; errors fail admission before tools run.
import { readFileSync as requireRead, realpathSync } from "node:fs";

export async function runPiSession(input: PiSessionInput, dependencies: PiSessionDependencies = {}): Promise<string> {
  const mode = process.env.WORKER_PI_EXECUTION_MODE ?? "gondolin";
  if (mode !== "host" && mode !== "gondolin") throw new Error("WORKER_PI_EXECUTION_MODE must be host or gondolin");
  const sessionRoot = process.env.PI_SESSION_DIR ?? join(process.env.HOME ?? "/tmp", ".pi", "agent", "sessions");
  const storeDir = join(sessionRoot, "durable");
  await mkdir(storeDir, { recursive: true, mode: 0o700 });
  const skillsDirectory = process.env.PI_TASK_SKILLS_DIR;
  let vm: GondolinSession | undefined;
  let runStopHook: (() => Promise<void>) | undefined;
  if (mode === "gondolin") {
    const policy = gondolinPolicy(input.workspace);
    if (policy.giteaRepository && policy.giteaRepository !== input.giteaRepository) {
      throw new Error("Gondolin Gitea repository does not match the task workspace");
    }
    const gitea = await taskGitea(policy.giteaRepository);
    const development = policy.development;
    const devSession = development?.docker === true;
    const assetArch = arch() === "arm64" ? "aarch64" : "x86_64";
    const imagePath = input.imageRef ?? policy.image ?? process.env.GONDOLIN_BROWSER_ASSETS
      ?? resolve("artifacts", "gondolin-browser", assetArch);
    vm = (dependencies.createGondolinSession ?? ((options) => new GondolinSession(options)))({
      imagePath, mounts: {
        "/workspace": input.workspace,
        ...(skillsDirectory ? { "/skills": { hostPath: skillsDirectory, readonly: true } } : {}),
      },
      network: gitea ? {
        allowedHosts: [...new Set([...(policy.network ? policy.network.allowedHosts : []), gitea.guest.hostname])],
        allowedInternalHosts: [gitea.upstream.hostname],
        secrets: {
          GITEA_TOKEN: { value: gitea.token, hosts: [gitea.upstream.hostname] },
        },
        onRequest: (request: Request) => rewriteGiteaRepositoryRequest(
          request, gitea.guest, gitea.upstream, gitea.owner, gitea.repository),
      } : policy.network,
      ...(gitea ? { dns: { mode: "synthetic" as const, syntheticHostMapping: "per-host" as const } } : {}),
      environment: {
        ...(devSession ? {
          PATH: "/opt/flutter/bin:/opt/flutter/bin/cache/dart-sdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
          FLUTTER_HOME: "/opt/flutter", FLUTTER_ROOT: "/opt/flutter", PUB_CACHE: "/var/cache/pub",
          PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright",
        } : {}),
        ...policy.environment,
        ...(gitea ? {
          GITEA_BASE_URL: gitea.guest.origin,
          GITEA_OWNER: gitea.owner,
          GITEA_REPOSITORY: gitea.repository,
          GITEA_USERNAME: gitea.username,
        } : {}),
      },
      memory: policy.memory, cpus: policy.cpus,
      sandbox: development?.vmm ? { vmm: development.vmm } : undefined,
      rootfs: { mode: "cow", ...(devSession ? { size: development?.disk ?? "64G" } : {}) },
      startupCommands: devSession || policy.startHooks.length ? [
        ...(devSession ? [["/usr/local/bin/start-dev-docker"]] : []),
        ...policy.startHooks.map((hook) => guestHookCommand(hook)),
      ] : undefined,
      sessionLabel: `pi-durable-${input.taskId}`,
    });
    await vm.start();
    if (policy.stopHook) {
      const activeVm = vm;
      const args = gitea
        ? [`pi/task-${input.taskId}`, `${gitea.guest.origin}/${gitea.owner}/${gitea.repository}.git`]
        : [];
      runStopHook = async () => {
        const result = await activeVm.run(guestHookCommand(policy.stopHook!, args),
          { signal: AbortSignal.timeout(30_000) });
        if (!result.ok) throw new Error(`Pi session stop hook failed: ${result.stderr.trim().slice(-1000)}`);
      };
    }
  }
  let session: DurableTaskSession | undefined;
  let bridge: RemoteTaskBridge | undefined;
  let handedOff = false;
  const abort = () => {
    if (bridge) void bridge.close();
    else { void session?.close(); void vm?.close(); }
  };
  input.signal?.addEventListener("abort", abort, { once: true });
  try {
    session = await DurableTaskSession.open({
      storagePath: join(storeDir, `${input.taskId}.sqlite`),
      workspace: mode === "gondolin" ? "/workspace" : input.workspace,
      env: vm ? new GondolinExecutionEnv(vm, input.taskId) : undefined,
      models: dependencies.models,
      authPath: join(process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME ?? "/tmp", ".pi", "agent"), "auth.json"),
      skillsDirectory: mode === "gondolin" && skillsDirectory ? "/skills" : skillsDirectory,
      model: modelFromEnv(process.env.PI_MODEL),
      thinkingLevel: (process.env.PI_THINKING ?? "medium") as "medium",
      mcpServers: await mcpServers(),
      onEvent: (event) => {
        if (event.type === "tool_execution_start") input.onProgress?.(`Using ${event.toolName}.`);
        bridge?.event(event);
      },
    });
    const socketDirectory = process.env.PI_TASK_SESSION_SOCKET_DIR
      ?? `/tmp/awp-pi-task-${process.getuid?.() ?? "owner"}`;
    const idleSeconds = Number(process.env.PI_TASK_SESSION_IDLE_SECONDS ?? "30");
    if (!Number.isFinite(idleSeconds) || idleSeconds < 0 || idleSeconds > 300) {
      throw new Error("PI_TASK_SESSION_IDLE_SECONDS must be between 0 and 300");
    }
    bridge = new RemoteTaskBridge(input.taskId, session, socketDirectory, idleSeconds,
      async () => { await vm?.close(); }, runStopHook);
    await bridge.start();
    bridge.initialStarted();
    const answer = await session.submit(input.instruction, input.taskId);
    await runStopHook?.();
    bridge.initialSettled(answer.text);
    handedOff = true;
    return answer.text;
  } finally {
    input.signal?.removeEventListener("abort", abort);
    if (!handedOff) {
      if (bridge) await bridge.close();
      else { await session?.close(); await vm?.close(); }
    }
  }
}
